import crypto from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import DodoPayments from "dodopayments";
import { nanoid } from "nanoid";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { PAYMENT_STATES, canTransitionPaymentState, normalizePaymentState } from "../paymentStates";

const DATA_DIR = process.env.SETTLEFLOW_DATA_DIR || (process.env.VERCEL ? "/tmp/settleflow" : path.join(process.cwd(), "data"));
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";
const AUTH_USERS_TABLE = "settleflow_users";
const APP_INVOICES_TABLE = "settleflow_invoices";
const memoryStore = globalThis.__settleflowMemoryStore || {
  [INVOICES_FILE]: null,
  [USERS_FILE]: null
};
globalThis.__settleflowMemoryStore = memoryStore;
const supabaseGlobal = globalThis.__settleflowSupabase || { client: null };
globalThis.__settleflowSupabase = supabaseGlobal;

const mockBuyerHistory = [
  { id: "TX-901", amount: 9200, status: "paid", settledInHours: 4 },
  { id: "TX-902", amount: 17500, status: "paid", settledInHours: 12 },
  { id: "TX-903", amount: 22000, status: "late", settledInHours: 96 }
];

function loadLocalEnvFallback() {
  if (process.env.VERCEL) return;

  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "..", "backend", ".env")
  ];

  for (const envFile of candidates) {
    if (!fsSync.existsSync(envFile)) continue;
    const raw = fsSync.readFileSync(envFile, "utf-8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const separator = trimmed.indexOf("=");
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadLocalEnvFallback();

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function transitionInvoiceStatus(invoice, nextStatus, patch = {}) {
  const currentStatus = normalizePaymentState(invoice.status);
  const normalizedNext = normalizePaymentState(nextStatus);

  if (!canTransitionPaymentState(currentStatus, normalizedNext)) {
    throw new ApiError(`Invalid payment state transition: ${currentStatus} -> ${normalizedNext}`, 409);
  }

  return {
    ...invoice,
    ...patch,
    status: normalizedNext,
    status_updated_at: new Date().toISOString()
  };
}

function isSettledInvoice(invoice) {
  return normalizePaymentState(invoice.status) === PAYMENT_STATES.WITHDRAWN;
}

async function readJson(file, fallback) {
  if (memoryStore[file]) {
    return memoryStore[file];
  }

  try {
    const raw = await fs.readFile(file, "utf-8");
    const data = JSON.parse(raw);
    memoryStore[file] = data;
    return data;
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(file, JSON.stringify(fallback, null, 2));
      memoryStore[file] = fallback;
      return fallback;
    }
    throw error;
  }
}

async function writeJson(file, data) {
  memoryStore[file] = data;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function supabaseClient() {
  const configuredUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL;
  if (!configuredUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const supabaseUrl = configuredUrl.trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
    throw new ApiError(
      "SUPABASE_URL is invalid. Use the Project URL from Supabase Settings > API, like https://your-project-ref.supabase.co. Do not use the app.supabase.com dashboard URL.",
      500
    );
  }

  if (!supabaseGlobal.client) {
    supabaseGlobal.client = createClient(
      supabaseUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
  }

  return supabaseGlobal.client;
}

function supabaseErrorMessage(error) {
  const message = String(error?.message || error || "Unknown Supabase error");
  if (message.trim().startsWith("<!DOCTYPE") || message.includes("<html")) {
    return "Supabase returned an HTML page instead of JSON. Check SUPABASE_URL in Vercel: it must be https://your-project-ref.supabase.co, not the Supabase dashboard URL.";
  }
  if (message.includes("schema cache") || message.includes("Could not find the table")) {
    return "Supabase tables are missing. Run frontend/supabase/schema.sql in Supabase SQL Editor, then redeploy.";
  }

  return message;
}

function isMissingSupabaseTable(error) {
  const message = String(error?.message || "");
  return error?.code === "42P01" || message.includes("schema cache") || message.includes("Could not find the table");
}

function supabaseEnabled() {
  return Boolean(supabaseClient());
}

function shouldUseJsonFallback() {
  return !process.env.VERCEL;
}

function requireAuthSupabase(supabase) {
  if (supabase) return;
  if (process.env.VERCEL) {
    throw new ApiError("Auth storage is not connected. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.", 500);
  }
}

function toUserRecord(user) {
  return {
    id: user.id,
    email: normalizeEmail(user.email),
    name: user.name,
    company: user.company || "",
    password_hash: user.passwordHash,
    reset_code: user.resetCode || null,
    reset_code_expires_at: user.resetCodeExpiresAt || null,
    created_at: user.createdAt || new Date().toISOString()
  };
}

function fromUserRecord(record) {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    company: record.company || "",
    passwordHash: record.password_hash,
    resetCode: record.reset_code || undefined,
    resetCodeExpiresAt: record.reset_code_expires_at || undefined,
    sessionTokens: [],
    createdAt: record.created_at
  };
}

function toInvoiceRecord(invoice) {
  return {
    id: invoice.id,
    owner_user_id: invoice.ownerUserId,
    data: invoice,
    created_at: invoice.createdAt || new Date().toISOString()
  };
}

function fromInvoiceRecord(record) {
  const invoice = {
    ...(record.data || {}),
    id: record.id,
    ownerUserId: record.owner_user_id,
    createdAt: record.data?.createdAt || record.created_at
  };

  return {
    ...invoice,
    status: normalizePaymentState(invoice.status)
  };
}

function escrowStatusFromInvoice(invoice) {
  return normalizePaymentState(invoice.status);
}

function toEscrowInvoiceRecord(invoice) {
  const planned = withPaymentPlan(invoice);
  return {
    id: planned.id,
    share_token: planned.share_token || planned.tracking_token,
    seller_id: null,
    title: planned.title,
    description: planned.description,
    client_name: planned.buyer,
    client_email: planned.buyer_email || null,
    amount: planned.amount,
    funded_amount: planned.paid_amount || 0,
    seller_wallet: planned.seller_wallet || planned.stablecoin?.sellerWallet || null,
    due_date: planned.due_date || null,
    allow_partial_funding: planned.allow_partial_funding,
    milestones: planned.milestones || [],
    status: escrowStatusFromInvoice(planned),
    escrow_enabled: planned.escrow_enabled,
    created_at: planned.createdAt || new Date().toISOString()
  };
}

async function mirrorEscrowInvoice(invoice) {
  const supabase = supabaseClient();
  if (!supabase || !invoice?.id) return;

  const planned = withPaymentPlan(invoice);
  const { error } = await supabase
    .from("invoices")
    .upsert(toEscrowInvoiceRecord(planned), { onConflict: "id" });

  if (error) {
    console.warn("Escrow invoice realtime mirror skipped:", supabaseErrorMessage(error));
  }

  if (planned.payment_method === "dodo" && planned.seller_payout?.status && normalizePaymentState(planned.seller_payout.status) !== PAYMENT_STATES.DRAFT) {
    const { error: payoutError } = await supabase
      .from("seller_payouts")
      .upsert({
        invoice_id: planned.id,
        seller_name: planned.seller,
        seller_email: planned.seller_email || null,
        seller_wallet: planned.seller_wallet || planned.seller_payout.sellerWallet || null,
        amount: planned.seller_payout.amount || (normalizePaymentState(planned.seller_payout.status) === PAYMENT_STATES.DRAFT ? 0 : planned.amount),
        currency: planned.seller_payout.currency || planned.currency || "USDC",
        provider: planned.seller_payout.provider || "anchor_usdc",
        status: planned.seller_payout.status,
        reference: planned.seller_payout.reference || null,
        note: planned.seller_payout.explorerUrl
          ? `${planned.seller_payout.note || ""} ${planned.seller_payout.explorerUrl}`.trim()
          : planned.seller_payout.note || null,
        paid_at: planned.seller_payout.paidAt || null,
        created_at: planned.seller_payout.createdAt || planned.createdAt || new Date().toISOString(),
        updated_at: planned.seller_payout.updatedAt || new Date().toISOString()
      }, { onConflict: "invoice_id" });

    if (payoutError) {
      console.warn("Seller payout realtime mirror skipped:", supabaseErrorMessage(payoutError));
    }
  }
}

async function recordInvoiceEvent(invoice, eventType, description) {
  const supabase = supabaseClient();
  if (!supabase || !invoice?.id) return;

  await mirrorEscrowInvoice(invoice);
  const { error } = await supabase
    .from("invoice_events")
    .insert({
      invoice_id: invoice.id,
      event_type: eventType,
      description
    });

  if (error) {
    console.warn("Invoice realtime event skipped:", supabaseErrorMessage(error));
  }
}

function publicInvoice(invoice) {
  const safeInvoice = withPaymentPlan(invoice);
  return {
    id: safeInvoice.id,
    share_token: safeInvoice.share_token || safeInvoice.tracking_token,
    title: safeInvoice.title || "Escrow protected invoice",
    description: safeInvoice.description || "",
    amount: safeInvoice.amount,
    currency: safeInvoice.currency,
    buyer: safeInvoice.buyer,
    seller: safeInvoice.seller,
    status: safeInvoice.status,
    payment_method: safeInvoice.payment_method,
    escrow_enabled: safeInvoice.escrow_enabled !== false,
    allow_partial_funding: Boolean(safeInvoice.allow_partial_funding),
    due_date: safeInvoice.due_date || null,
    upfront_percentage: safeInvoice.upfront_percentage,
    upfront_amount: safeInvoice.upfront_amount,
    remaining_amount: safeInvoice.remaining_amount,
    paid_amount: safeInvoice.paid_amount,
    payment_progress: safeInvoice.payment_progress,
    upfront_paid: safeInvoice.upfront_paid,
    remaining_paid: safeInvoice.remaining_paid,
    funded_at: safeInvoice.funded_at,
    completed_at: safeInvoice.completed_at,
    createdAt: safeInvoice.createdAt,
    risk: safeInvoice.risk,
    payment: {
      provider: safeInvoice.payment?.provider || "dodo",
      status: safeInvoice.payment?.status || PAYMENT_STATES.DRAFT,
      updatedAt: safeInvoice.payment?.updatedAt || null,
      createdAt: safeInvoice.payment?.createdAt || null
    },
    seller_payout: {
      status: safeInvoice.seller_payout?.status || PAYMENT_STATES.DRAFT,
      amount: safeInvoice.seller_payout?.amount || 0,
      reference: safeInvoice.seller_payout?.reference || null,
      explorerUrl: safeInvoice.seller_payout?.explorerUrl || null,
      paidAt: safeInvoice.seller_payout?.paidAt || null,
      updatedAt: safeInvoice.seller_payout?.updatedAt || null
    },
    fiat_escrow: {
      status: safeInvoice.fiat_escrow?.status || PAYMENT_STATES.DRAFT,
      treasuryTx: safeInvoice.fiat_escrow?.treasuryTx || null,
      treasuryExplorerUrl: safeInvoice.fiat_escrow?.treasuryExplorerUrl || null,
      withdrawalTx: safeInvoice.fiat_escrow?.withdrawalTx || null,
      withdrawalExplorerUrl: safeInvoice.fiat_escrow?.withdrawalExplorerUrl || null,
      fundedAt: safeInvoice.fiat_escrow?.fundedAt || null,
      withdrawnAt: safeInvoice.fiat_escrow?.withdrawnAt || null
    },
    stablecoin: {
      chain: safeInvoice.stablecoin?.chain,
      token: safeInvoice.stablecoin?.token,
      status: normalizePaymentState(safeInvoice.stablecoin?.status || safeInvoice.status),
      escrowTx: safeInvoice.stablecoin?.escrowTx || null,
      escrowExplorerUrl: safeInvoice.stablecoin?.escrowExplorerUrl || null,
      releaseTx: safeInvoice.stablecoin?.releaseTx || null,
      releaseExplorerUrl: safeInvoice.stablecoin?.releaseExplorerUrl || null
    }
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword = "") {
  const [iterations, salt, storedHash] = String(storedPassword || "").split(":");
  if (!iterations || !salt || !storedHash) {
    return storedPassword === password;
  }
  if (!Number.isFinite(Number(iterations))) {
    return false;
  }

  const hash = crypto.pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST).toString("hex");
  const hashBuffer = Buffer.from(hash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");
  return hashBuffer.length === storedBuffer.length && crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company,
    createdAt: user.createdAt
  };
}

function normalizeEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function userIdFromEmail(email) {
  const digest = crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 10).toUpperCase();
  return `USR-${digest}`;
}

function displayNameFromEmail(email) {
  const localPart = normalizeEmail(email).split("@")[0] || "User";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "User";
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf-8"));
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "settleflow-vercel-test-secret";
}

function signSessionToken(user) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company || "",
    createdAt: user.createdAt,
    iat: Date.now()
  };
  const encoded = base64UrlEncode(payload);
  const signature = crypto.createHmac("sha256", authSecret()).update(encoded).digest("base64url");
  return `sf_${encoded}.${signature}`;
}

function verifySessionToken(token) {
  if (!token?.startsWith("sf_")) return null;

  const [encoded, signature] = token.slice(3).split(".");
  if (!encoded || !signature) return null;

  const expected = crypto.createHmac("sha256", authSecret()).update(encoded).digest("base64url");
  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  return base64UrlDecode(encoded);
}

async function readInvoices() {
  const supabase = supabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from(APP_INVOICES_TABLE)
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Supabase readInvoices failed, using JSON fallback:", supabaseErrorMessage(error));
    } else {
      return data.map(fromInvoiceRecord);
    }
  }

  const invoices = await readJson(INVOICES_FILE, []);
  return invoices.map((invoice) => ({
    ...invoice,
    status: normalizePaymentState(invoice.status)
  }));
}

async function writeInvoices(invoices) {
  const supabase = supabaseClient();

  if (supabase) {
    const records = invoices.filter((invoice) => invoice?.id && invoice?.ownerUserId).map(toInvoiceRecord);
    const { error } = await supabase
      .from(APP_INVOICES_TABLE)
      .upsert(records, { onConflict: "id" });

    if (error) {
      console.error("Supabase writeInvoices failed, using JSON fallback:", supabaseErrorMessage(error));
    } else {
      memoryStore[INVOICES_FILE] = invoices;
      await Promise.allSettled(invoices.filter((invoice) => invoice?.id).map(mirrorEscrowInvoice));
      return;
    }
  }

  await writeJson(INVOICES_FILE, invoices);
}

async function readUsers() {
  const supabase = supabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from(AUTH_USERS_TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (!shouldUseJsonFallback()) throw new ApiError(`Unable to read accounts: ${supabaseErrorMessage(error)}`, 500);
      console.error("Supabase readUsers failed, using JSON fallback:", supabaseErrorMessage(error));
    } else {
      return data.map(fromUserRecord);
    }
  }

  requireAuthSupabase(supabase);
  return readJson(USERS_FILE, []);
}

async function writeUsers(users) {
  const deduped = new Map();

  for (const user of users) {
    const email = normalizeEmail(user.email);
    if (!email) continue;
    deduped.set(email, {
      ...user,
      id: user.id || userIdFromEmail(email),
      email
    });
  }

  const normalizedUsers = Array.from(deduped.values());
  const supabase = supabaseClient();

  if (supabase) {
    const { error } = await supabase
      .from(AUTH_USERS_TABLE)
      .upsert(normalizedUsers.map(toUserRecord), { onConflict: "email" });

    if (error) {
      if (!shouldUseJsonFallback()) throw new ApiError(`Unable to save accounts: ${supabaseErrorMessage(error)}`, 500);
      console.error("Supabase writeUsers failed, using JSON fallback:", supabaseErrorMessage(error));
    } else {
      memoryStore[USERS_FILE] = normalizedUsers;
      return;
    }
  }

  requireAuthSupabase(supabase);
  await writeJson(USERS_FILE, normalizedUsers);
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const supabase = supabaseClient();
  if (supabase) {
    const expectedId = userIdFromEmail(normalizedEmail);
    const { data: idRecord, error: idError } = await supabase
      .from(AUTH_USERS_TABLE)
      .select("*")
      .eq("id", expectedId)
      .maybeSingle();

    if (idError) {
      throw new ApiError(`Unable to check account: ${supabaseErrorMessage(idError)}`, 500);
    }

    if (idRecord) return fromUserRecord(idRecord);

    const { data, error } = await supabase
      .from(AUTH_USERS_TABLE)
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      throw new ApiError(`Unable to check account: ${supabaseErrorMessage(error)}`, 500);
    }

    if (data) return fromUserRecord(data);

    // Accounts created during earlier testing may have mixed-case or spaced emails.
    // Auth still reads from settleflow_users only; this fallback normalizes old rows.
    const { data: records, error: fallbackError } = await supabase
      .from(AUTH_USERS_TABLE)
      .select("*")
      .limit(1000);

    if (fallbackError) {
      throw new ApiError(`Unable to check account: ${supabaseErrorMessage(fallbackError)}`, 500);
    }

    const matchedRecord = records?.find((record) => normalizeEmail(record.email) === normalizedEmail);
    return matchedRecord ? fromUserRecord(matchedRecord) : null;
  }

  requireAuthSupabase(supabase);
  const users = await readUsers();
  return users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null;
}

async function saveUser(user) {
  const normalizedUser = {
    ...user,
    id: user.id || userIdFromEmail(user.email),
    email: normalizeEmail(user.email)
  };

  const supabase = supabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from(AUTH_USERS_TABLE)
      .upsert(toUserRecord(normalizedUser), { onConflict: "id" })
      .select("*")
      .single();

    if (error) {
      throw new ApiError(`Unable to save account: ${supabaseErrorMessage(error)}`, 500);
    }

    return fromUserRecord(data);
  }

  requireAuthSupabase(supabase);
  const users = await readUsers();
  const nextUsers = users.filter((item) => normalizeEmail(item.email) !== normalizedUser.email);
  nextUsers.unshift(normalizedUser);
  await writeUsers(nextUsers);
  return normalizedUser;
}

async function createUser(user) {
  const normalizedUser = {
    ...user,
    id: user.id || userIdFromEmail(user.email),
    email: normalizeEmail(user.email)
  };

  const supabase = supabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from(AUTH_USERS_TABLE)
      .insert(toUserRecord(normalizedUser))
      .select("*")
      .single();

    if (error?.code === "23505") {
      throw new ApiError("An account with this email already exists. Please log in instead.", 409);
    }

    if (error) {
      throw new ApiError(`Unable to create account: ${supabaseErrorMessage(error)}`, 500);
    }

    return fromUserRecord(data);
  }

  requireAuthSupabase(supabase);
  const existingUser = await findUserByEmail(normalizedUser.email);
  if (existingUser) {
    throw new ApiError("An account with this email already exists. Please log in instead.", 409);
  }

  const users = await readUsers();
  users.unshift(normalizedUser);
  await writeUsers(users);
  return normalizedUser;
}

async function clearAllAuthData() {
  const supabase = supabaseClient();
  const skipped = [];

  if (supabase) {
    const { error: invoiceError } = await supabase
      .from(APP_INVOICES_TABLE)
      .delete()
      .neq("id", "__never__");

    if (invoiceError) {
      if (isMissingSupabaseTable(invoiceError)) {
        skipped.push(APP_INVOICES_TABLE);
      } else {
        throw new ApiError(`Unable to clear invoices: ${supabaseErrorMessage(invoiceError)}`, 500);
      }
    }

    for (const table of ["invoice_events", "escrow_transactions", "seller_payouts", "invoices"]) {
      const { error } = await supabase
        .from(table)
        .delete()
        .neq("id", table === "invoices" ? "__never__" : "00000000-0000-0000-0000-000000000000");

      if (error) {
        if (isMissingSupabaseTable(error)) {
          skipped.push(table);
        } else {
          throw new ApiError(`Unable to clear ${table}: ${supabaseErrorMessage(error)}`, 500);
        }
      }
    }

    const { error: userError } = await supabase
      .from(AUTH_USERS_TABLE)
      .delete()
      .neq("id", "__never__");

    if (userError) {
      if (isMissingSupabaseTable(userError)) {
        skipped.push(AUTH_USERS_TABLE);
      } else {
        throw new ApiError(`Unable to clear users: ${supabaseErrorMessage(userError)}`, 500);
      }
    }
  }

  memoryStore[USERS_FILE] = [];
  memoryStore[INVOICES_FILE] = [];
  await writeJson(USERS_FILE, []);
  await writeJson(INVOICES_FILE, []);
  return { skipped };
}

async function sendResetCodeEmail({ email, code, name }) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY is not configured" };
  }

  const from = process.env.RESET_EMAIL_FROM || "SettleFlow <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your SettleFlow password reset code",
      text: `Hi ${name || "there"},\n\nYour SettleFlow reset code is ${code}.\n\nThis code expires in 15 minutes. If you did not request it, you can ignore this email.`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#06140d">
          <h2>Your SettleFlow reset code</h2>
          <p>Hi ${name || "there"},</p>
          <p>Use this code to reset your password:</p>
          <div style="display:inline-block;padding:14px 18px;border-radius:12px;background:#e9f8d8;font-size:28px;font-weight:800;letter-spacing:6px">${code}</div>
          <p>This code expires in 15 minutes.</p>
        </div>
      `
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.message || "Unable to send reset email", 502);
  }

  return { sent: true };
}

async function sendSettleFlowEmail({ to, subject, preview, actionUrl, actionLabel = "View invoice" }) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).map((email) => normalizeEmail(email)).filter(Boolean))];
  if (!recipients.length || !process.env.RESEND_API_KEY) {
    console.warn("SettleFlow email skipped:", !recipients.length ? "no recipients" : "RESEND_API_KEY missing");
    return { sent: false };
  }

  const from = process.env.RESET_EMAIL_FROM || "SettleFlow <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      text: `${preview}${actionUrl ? `\n\n${actionLabel}: ${actionUrl}` : ""}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#06140d">
          <h2>${subject}</h2>
          <p>${preview}</p>
          ${actionUrl ? `<p><a href="${actionUrl}" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#06140d;color:white;text-decoration:none;font-weight:700">${actionLabel}</a></p>` : ""}
        </div>
      `
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.warn("SettleFlow email skipped:", data.message || response.statusText);
    return { sent: false };
  }

  return { sent: true };
}

async function notifyInvoiceEvent(invoice, event, requestUrl) {
  const origin = requestUrl ? new URL(requestUrl).origin : process.env.NEXT_PUBLIC_APP_URL || "";
  const actionUrl = origin ? `${origin}/dashboard/invoice/${invoice.id}` : "";
  const amount = `${Number(invoice.amount || 0).toLocaleString()} ${invoice.currency || "USDC"}`;
  let ownerEmail = invoice.owner_email;
  if (!ownerEmail && invoice.ownerUserId) {
    const users = await readUsers().catch(() => []);
    ownerEmail = users.find((user) => user.id === invoice.ownerUserId)?.email || "";
  }
  const recipients = [ownerEmail, invoice.buyer_email, invoice.seller_email];
  const subjects = {
    created: `SettleFlow invoice ${invoice.id} created`,
    locked: `SettleFlow invoice ${invoice.id} escrow funded`,
    released: `SettleFlow invoice ${invoice.id} escrow released`,
    withdrawn: `SettleFlow invoice ${invoice.id} seller withdrawal complete`
  };
  const previews = {
    created: `${invoice.seller} created a ${amount} invoice for ${invoice.buyer}. Preferred payment method: ${invoice.payment_method === "dodo" ? "Dodo card checkout" : "USDC escrow"}.`,
    locked: `${amount} is now locked for invoice ${invoice.id}.`,
    released: `${invoice.id} has been released from escrow and is ready for seller withdrawal.`,
    withdrawn: `${invoice.id} funds were withdrawn from the Anchor escrow vault.`
  };

  const result = await sendSettleFlowEmail({
    to: recipients,
    subject: subjects[event],
    preview: previews[event],
    actionUrl
  });
  await recordInvoiceEvent(invoice, event, previews[event]).catch((error) => console.warn("Invoice event log skipped:", error.message));
  console.log("SettleFlow email notification", { invoiceId: invoice.id, event, sent: result.sent, recipients: recipients.filter(Boolean).length });
}

async function updateInvoice(id, updater) {
  const supabase = supabaseClient();

  if (supabase) {
    const { data: record, error: readError } = await supabase
      .from(APP_INVOICES_TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("Supabase updateInvoice read failed, using JSON fallback:", supabaseErrorMessage(readError));
    } else if (record) {
      const updatedInvoice = updater(fromInvoiceRecord(record));
      const { data, error } = await supabase
        .from(APP_INVOICES_TABLE)
        .upsert(toInvoiceRecord(updatedInvoice), { onConflict: "id" })
        .select("*")
        .single();

      if (error) {
        console.error("Supabase updateInvoice write failed, using JSON fallback:", supabaseErrorMessage(error));
      } else {
        const saved = fromInvoiceRecord(data);
        await mirrorEscrowInvoice(saved);
        return saved;
      }
    } else {
      return null;
    }
  }

  const invoices = await readInvoices();
  const index = invoices.findIndex((invoice) => invoice.id === id);
  if (index === -1) return null;
  invoices[index] = updater(invoices[index]);
  await writeInvoices(invoices);
  await mirrorEscrowInvoice(invoices[index]);
  return invoices[index];
}

function normalizeUpfrontPercentage(value) {
  const percentage = Number(value || 50);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) return 50;
  return Math.round(percentage);
}

function getPaymentPlan(invoice) {
  const amount = Number(invoice.amount || 0);
  const upfrontPercentage = normalizeUpfrontPercentage(invoice.upfront_percentage);
  const upfrontAmount = Number(((amount * upfrontPercentage) / 100).toFixed(2));
  const remainingAmount = Number((amount - upfrontAmount).toFixed(2));
  const state = normalizePaymentState(invoice.status);
  const fiatOrEscrowProgress = [
    PAYMENT_STATES.FIAT_PAID,
    PAYMENT_STATES.TREASURY_FUNDING_PENDING,
    PAYMENT_STATES.ESCROW_FUNDED,
    PAYMENT_STATES.WORK_SUBMITTED,
    PAYMENT_STATES.RELEASE_PENDING,
    PAYMENT_STATES.RELEASED,
    PAYMENT_STATES.WITHDRAWN
  ].includes(state)
    ? amount
    : 0;
  const upfrontPaid = fiatOrEscrowProgress > 0;
  const remainingPaid = fiatOrEscrowProgress > 0;
  const paidAmount = fiatOrEscrowProgress;

  return {
    upfront_percentage: upfrontPercentage,
    upfront_amount: upfrontAmount,
    remaining_amount: remainingAmount,
    paid_amount: Number(paidAmount.toFixed(2)),
    payment_progress: amount > 0 ? Math.min(100, Math.round((paidAmount / amount) * 100)) : 0,
    upfront_paid: upfrontPaid,
    remaining_paid: remainingPaid
  };
}

function stablecoinConfig() {
  const signer = escrowKeypair();
  const treasurySigner = treasuryKeypair();
  return {
    rpcUrl: process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
    chain: process.env.STABLECOIN_CHAIN || "solana-devnet",
    symbol: process.env.STABLECOIN_SYMBOL || "USDC",
    mint: process.env.USDC_MINT || process.env.STABLECOIN_MINT_ADDRESS || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    escrowWallet: process.env.STABLECOIN_ESCROW_WALLET || signer?.publicKey.toBase58() || "",
    treasuryWallet: process.env.STABLECOIN_TREASURY_WALLET || process.env.TREASURY_WALLET || treasurySigner?.publicKey.toBase58() || "",
    decimals: Number(process.env.STABLECOIN_DECIMALS || 6)
  };
}

async function getTreasuryLiquidity() {
  const config = stablecoinConfig();
  const treasury = treasuryKeypair();

  if (!treasury || !config.mint) {
    return {
      configured: false,
      treasuryWallet: config.treasuryWallet || "",
      mint: config.mint || "",
      tokenAccount: "",
      sol: 0,
      usdc: 0
    };
  }

  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(config.mint);
  const tokenAccount = await getAssociatedTokenAddress(mint, treasury.publicKey);
  const [lamports, tokenBalance] = await Promise.all([
    connection.getBalance(treasury.publicKey).catch(() => 0),
    connection.getTokenAccountBalance(tokenAccount).catch(() => null)
  ]);

  return {
    configured: true,
    treasuryWallet: treasury.publicKey.toBase58(),
    mint: mint.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    sol: lamports / 1e9,
    usdc: Number(tokenBalance?.value?.uiAmountString || tokenBalance?.value?.uiAmount || 0)
  };
}

async function assertTreasuryLiquidityForCheckout(amount) {
  const liquidity = await getTreasuryLiquidity();
  const requiredAmount = Number(amount || 0);

  if (!liquidity.configured) {
    throw new ApiError("Treasury wallet is not configured. Add STABLECOIN_TREASURY_SECRET_KEY and USDC_MINT before taking Dodo payments.", 503);
  }

  if (liquidity.sol <= 0.000005) {
    throw new ApiError(`Treasury wallet needs devnet SOL for escrow fees. Wallet: ${liquidity.treasuryWallet}`, 402);
  }

  if (liquidity.usdc + Number.EPSILON < requiredAmount) {
    throw new ApiError(
      `Insufficient treasury USDC balance. Available ${liquidity.usdc.toLocaleString()} USDC, required ${requiredAmount.toLocaleString()} USDC. Treasury wallet: ${liquidity.treasuryWallet}. Mint: ${liquidity.mint}.`,
      402
    );
  }

  return liquidity;
}

function withPaymentPlan(invoice) {
  const amount = Number(invoice.amount || 0);
  const config = stablecoinConfig();
  const sellerPayout = invoice.seller_payout || {};
  const defaultPayoutStatus = PAYMENT_STATES.DRAFT;
  return {
    ...invoice,
    amount,
    currency: invoice.currency || "USDC",
    status: normalizePaymentState(invoice.status),
    buyer: invoice.buyer || "Unknown buyer",
    seller: invoice.seller || "Unknown seller",
    buyer_email: invoice.buyer_email || "",
    seller_email: invoice.seller_email || "",
    title: invoice.title || "Escrow protected invoice",
    description: invoice.description || "",
    due_date: invoice.due_date || null,
    seller_wallet: invoice.seller_wallet || "",
    escrow_enabled: invoice.escrow_enabled !== false,
    allow_partial_funding: Boolean(invoice.allow_partial_funding ?? true),
    milestones: Array.isArray(invoice.milestones) ? invoice.milestones : [],
    share_token: invoice.share_token || invoice.tracking_token || "",
    tracking_token: invoice.tracking_token || invoice.share_token || "",
    owner_email: invoice.owner_email || "",
    payment_method: "dodo",
    risk: invoice.risk || {
      risk_score: 0,
      risk_level: "Low",
      recommendation: "Risk analysis has not been generated for this invoice yet."
    },
    payment: invoice.payment || {
      provider: "dodo",
      status: PAYMENT_STATES.DRAFT,
      sessionId: null,
      checkoutUrl: null,
      paymentId: null,
      mode: "unconfigured"
    },
    seller_payout: {
      provider: sellerPayout.provider || "anchor_usdc",
      status: sellerPayout.status || defaultPayoutStatus,
      amount: Number(sellerPayout.amount || 0),
      currency: sellerPayout.currency || "USDC",
      reference: sellerPayout.reference || null,
      note: sellerPayout.note || "",
      sellerWallet: sellerPayout.sellerWallet || invoice.seller_wallet || "",
      tx: sellerPayout.tx || null,
      explorerUrl: sellerPayout.explorerUrl || null,
      sourceTokenAccount: sellerPayout.sourceTokenAccount || null,
      destinationTokenAccount: sellerPayout.destinationTokenAccount || null,
      createdAt: sellerPayout.createdAt || null,
      paidAt: sellerPayout.paidAt || null,
      updatedAt: sellerPayout.updatedAt || null
    },
    stablecoin: invoice.stablecoin || {
      chain: config.chain,
      token: config.symbol,
      mint: config.mint,
      status: PAYMENT_STATES.DRAFT,
      amount,
      escrowTx: null,
      releaseTx: null,
      mode: "anchor_pda_vault"
    },
    fiat_escrow: invoice.fiat_escrow || {
      status: PAYMENT_STATES.DRAFT,
      treasuryTx: null,
      withdrawalTx: null,
      fundedAt: null,
      approvedAt: null,
      withdrawnAt: null
    },
    ...getPaymentPlan(invoice)
  };
}

function buildAnalytics(invoices) {
  const completed = invoices.filter(isSettledInvoice);
  const totalSettled = completed.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const durations = completed
    .map((invoice) => {
      const fundedAt = invoice.funded_at ? new Date(invoice.funded_at).getTime() : NaN;
      const completedAt = invoice.completed_at ? new Date(invoice.completed_at).getTime() : NaN;
      return Number.isFinite(fundedAt) && Number.isFinite(completedAt) ? completedAt - fundedAt : null;
    })
    .filter((duration) => duration !== null && duration >= 0);
  const avg = durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 36e5 : 0;
  return {
    totalSettled: Number(totalSettled.toFixed(2)),
    avgSettlementTimeHours: avg > 0 && avg < 0.01 ? 0.01 : Number(avg.toFixed(2)),
    totalInvoices: invoices.length
  };
}

function normalizeDodoStatus(status) {
  return String(status || "").toLowerCase();
}

function isDodoPaid(status) {
  return ["succeeded", "payment_succeeded", "payment.succeeded", "paid", "completed", "complete", "captured", "confirmed", "success"].includes(
    normalizeDodoStatus(status)
  );
}

function explorerUrl(signature) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : null;
}

function dodoWebhookStrict() {
  return process.env.DODO_WEBHOOK_STRICT === "true";
}

function parseJsonSafely(rawBody) {
  try {
    return JSON.parse(rawBody || "{}");
  } catch {
    return {};
  }
}

function extractDodoWebhookData(payload) {
  const data = payload.data || payload;
  const nestedPayment = data.payment || data.payload || {};
  const metadata = data.metadata || nestedPayment.metadata || {};

  return {
    data,
    invoiceId:
      metadata.invoice_id ||
      metadata.invoiceId ||
      data.invoice_id ||
      data.invoiceId ||
      nestedPayment.invoice_id ||
      nestedPayment.invoiceId,
    paymentStatus:
      data.payment_status ||
      data.paymentStatus ||
      data.status ||
      data.event_type ||
      data.event ||
      nestedPayment.payment_status ||
      nestedPayment.paymentStatus ||
      nestedPayment.status ||
      payload.type?.replace("payment.", ""),
    paymentId: data.payment_id || data.id || nestedPayment.payment_id || nestedPayment.id || null
  };
}

function applyDodoPaymentStatus(invoice, paymentStatus, data = {}) {
  const paid = isDodoPaid(paymentStatus);
  const now = new Date().toISOString();
  const existingPayout = invoice.seller_payout || {};
  const existingFiatEscrow = invoice.fiat_escrow || {};
  const currentStatus = normalizePaymentState(invoice.status);
  const nextInvoiceStatus = paid && canTransitionPaymentState(currentStatus, PAYMENT_STATES.FIAT_PAID)
    ? PAYMENT_STATES.FIAT_PAID
    : currentStatus;
  const nextPayoutStatus = paid
    ? ["withdrawn", "released", "escrow_funded"].includes(existingPayout.status)
      ? existingPayout.status
      : PAYMENT_STATES.TREASURY_FUNDING_PENDING
    : existingPayout.status;

  return {
    ...invoice,
    status: nextInvoiceStatus,
    upfront_paid: paid ? true : invoice.upfront_paid || false,
    remaining_paid: paid ? true : invoice.remaining_paid || false,
    paid_amount: paid ? Number(invoice.amount || 0) : invoice.paid_amount || 0,
    fiat_paid_at: paid ? invoice.fiat_paid_at || now : invoice.fiat_paid_at || null,
    completed_at: invoice.completed_at || null,
    payment: {
      ...(invoice.payment || {}),
      provider: "dodo",
      status: paymentStatus || "webhook_received",
      paymentId: data.payment_id || data.id || data.paymentId || data.payment?.id || invoice.payment?.paymentId || null,
      updatedAt: now
    },
    seller_payout: paid
      ? {
          provider: existingPayout.provider || "anchor_usdc",
          status: nextPayoutStatus,
          amount: Number(invoice.amount || 0),
          currency: invoice.currency || "USDC",
          reference: existingPayout.reference || null,
          note: existingPayout.note || "Dodo collected buyer payment. Treasury must fund USDC escrow next.",
          createdAt: existingPayout.createdAt || now,
          paidAt: existingPayout.paidAt || null,
          updatedAt: now
        }
      : existingPayout,
    fiat_escrow: paid
      ? {
          ...existingFiatEscrow,
          status: normalizePaymentState(existingFiatEscrow.status) === PAYMENT_STATES.WITHDRAWN
            ? PAYMENT_STATES.WITHDRAWN
            : normalizePaymentState(existingFiatEscrow.status) === PAYMENT_STATES.ESCROW_FUNDED
              ? PAYMENT_STATES.ESCROW_FUNDED
              : PAYMENT_STATES.TREASURY_FUNDING_PENDING,
          updatedAt: now
        }
      : existingFiatEscrow
  };
}

function treasuryFundingErrorMessage(error, amount) {
  const rawMessage = String(error?.message || error || "Automatic treasury escrow funding failed.");
  const lowerMessage = rawMessage.toLowerCase();
  const requiredAmount = Number(amount || 0).toLocaleString();

  if (
    lowerMessage.includes("treasury wallet needs") ||
    lowerMessage.includes("insufficient treasury") ||
    lowerMessage.includes("insufficient funds") ||
    lowerMessage.includes("attempt to debit") ||
    lowerMessage.includes("no record of a prior credit")
  ) {
    if (lowerMessage.includes("available") && lowerMessage.includes("required")) {
      return rawMessage;
    }

    if (lowerMessage.includes("sol")) {
      return "Insufficient treasury SOL balance. Add devnet SOL to the treasury wallet for transaction fees, then sync the invoice again.";
    }

    return `Insufficient treasury USDC balance. The treasury wallet needs at least ${requiredAmount} USDC before it can secure this invoice on-chain.`;
  }

  if (lowerMessage.includes("not confirmed")) {
    return "Treasury transaction was submitted but not confirmed yet. Refresh in a few seconds to check the latest escrow state.";
  }

  return rawMessage;
}

async function markTreasuryFundingFailed(id, error) {
  const now = new Date().toISOString();
  const invoices = await readInvoices();
  const invoice = invoices.find((item) => item.id === id);
  const message = treasuryFundingErrorMessage(error, invoice?.amount);

  const updated = await updateInvoice(id, (current) => ({
    ...current,
    fiat_escrow: {
      ...(current.fiat_escrow || {}),
      status: normalizePaymentState(current.fiat_escrow?.status || current.status),
      fundingError: message,
      fundingFailedAt: now,
      updatedAt: now
    },
    stablecoin: {
      ...(current.stablecoin || {}),
      status: normalizePaymentState(current.stablecoin?.status || current.status),
      fundingError: message,
      fundingFailedAt: now
    },
    seller_payout: {
      ...(current.seller_payout || {}),
      provider: "anchor_usdc",
      status: normalizePaymentState(current.seller_payout?.status || current.status),
      note: message,
      updatedAt: now
    }
  }));

  return { invoice: updated, message };
}

async function fundTreasuryEscrowForInvoice(id, { userId = null, source = "automatic" } = {}) {
  if (!id) throw new ApiError("invoice id is required", 400);

  const invoices = await readInvoices();
  const invoice = userId
    ? getOwnedInvoice(invoices, id, userId)
    : invoices.find((item) => item.id === id);

  if (!invoice) throw new ApiError("Invoice not found", 404);

  const state = normalizePaymentState(invoice.status);
  if (state === PAYMENT_STATES.ESCROW_FUNDED || state === PAYMENT_STATES.WORK_SUBMITTED || state === PAYMENT_STATES.RELEASED || state === PAYMENT_STATES.WITHDRAWN) {
    return withPaymentPlan(invoice);
  }

  if (state !== PAYMENT_STATES.FIAT_PAID && state !== PAYMENT_STATES.TREASURY_FUNDING_PENDING) {
    throw new ApiError("Dodo fiat payment must be confirmed before treasury funds escrow.", 400);
  }

  if (normalizePaymentState(invoice.fiat_escrow?.status) === PAYMENT_STATES.ESCROW_FUNDED) {
    return withPaymentPlan(invoice);
  }

  const sellerWallet = String(invoice.seller_wallet || invoice.seller_payout?.sellerWallet || "").trim();
  if (!sellerWallet) throw new ApiError("Seller Solana wallet is missing. Create invoices with a seller wallet before funding escrow.", 400);
  new PublicKey(sellerWallet);

  const now = new Date().toISOString();
  let funding;

  try {
    await updateInvoice(id, (current) => transitionInvoiceStatus(current, PAYMENT_STATES.TREASURY_FUNDING_PENDING, {
      treasury_funding_started_at: current.treasury_funding_started_at || now,
      fiat_escrow: {
        ...(current.fiat_escrow || {}),
        status: PAYMENT_STATES.TREASURY_FUNDING_PENDING,
        note: source === "automatic" ? "Automatic treasury funding started after Dodo webhook." : "Treasury funding retry started.",
        fundingError: null,
        updatedAt: now
      },
      stablecoin: {
        ...(current.stablecoin || {}),
        status: PAYMENT_STATES.TREASURY_FUNDING_PENDING,
        fundingError: null,
        updatedAt: now
      },
      seller_payout: {
        ...(current.seller_payout || {}),
        provider: "anchor_usdc",
        status: PAYMENT_STATES.TREASURY_FUNDING_PENDING,
        note: "Treasury is locking USDC into the Anchor escrow vault.",
        updatedAt: now
      }
    }));

    funding = await initializeAndFundAnchorEscrow({ invoiceId: invoice.id, sellerWallet, amount: invoice.amount });
  } catch (error) {
    const failure = await markTreasuryFundingFailed(id, error);
    await recordInvoiceEvent(failure.invoice, "treasury_funding_failed", failure.message).catch((eventError) => console.warn("Treasury funding failure event skipped:", eventError.message));
    throw new ApiError(failure.message, error.status || 400);
  }

  const updated = await updateInvoice(id, (current) => transitionInvoiceStatus(current, PAYMENT_STATES.ESCROW_FUNDED, {
    funded_at: current.funded_at || now,
    escrow_funded_at: current.escrow_funded_at || now,
    fiat_escrow: {
      ...(current.fiat_escrow || {}),
      status: PAYMENT_STATES.ESCROW_FUNDED,
      treasuryTx: funding.signature,
      treasuryExplorerUrl: funding.explorerUrl,
      fundingError: null,
      fundedAt: now,
      updatedAt: now
    },
    stablecoin: {
      ...(current.stablecoin || {}),
      status: PAYMENT_STATES.ESCROW_FUNDED,
      escrowTx: funding.signature,
      escrowExplorerUrl: funding.explorerUrl,
      escrowAccount: funding.escrowAccount,
      vaultTokenAccount: funding.vaultTokenAccount,
      sourceTokenAccount: funding.treasuryTokenAccount,
      sellerWallet,
      fundingError: null,
      mode: "anchor_pda_vault"
    },
    seller_payout: {
      ...(current.seller_payout || {}),
      provider: "anchor_usdc",
      status: PAYMENT_STATES.ESCROW_FUNDED,
      amount: Number(current.amount || 0),
      currency: current.currency || "USDC",
      sellerWallet,
      reference: funding.signature,
      note: "Treasury funded the Anchor escrow vault after Dodo fiat collection.",
      createdAt: current.seller_payout?.createdAt || now,
      updatedAt: now,
      tx: funding.signature,
      explorerUrl: funding.explorerUrl
    }
  }));

  await recordInvoiceEvent(updated, "escrow_funded", `Treasury funded Anchor escrow vault. Tx ${funding.signature}.`).catch((error) => console.warn("Treasury funding event skipped:", error.message));
  return withPaymentPlan(updated);
}

function riskRecommendation({ amount, history = [], riskLevel }) {
  const numericAmount = Number(amount || 0);
  const latePayments = history.filter((item) => item.status === "late").length;
  const disputedPayments = history.filter((item) => item.status === "disputed").length;
  const amountLabel = `${numericAmount.toLocaleString()} USDC`;
  const historySignal = disputedPayments > 0
    ? `${disputedPayments} disputed buyer payment${disputedPayments === 1 ? "" : "s"}`
    : latePayments > 0
      ? `${latePayments} late buyer payment${latePayments === 1 ? "" : "s"}`
      : "clean buyer history";
  const amountBand = numericAmount >= 50000
    ? "very large"
    : numericAmount >= 25000
      ? "large"
      : numericAmount >= 10000
        ? "mid-market"
        : numericAmount >= 1000
          ? "standard"
          : "small";

  if (riskLevel === "Low") {
    return `Approve escrow for ${amountLabel}. This is a ${amountBand} invoice with ${historySignal}; keep the normal buyer release step before seller withdrawal.`;
  }

  if (riskLevel === "Medium") {
    return `Review escrow for ${amountLabel} before release. This ${amountBand} invoice carries ${historySignal}, so confirm delivery evidence before allowing withdrawal.`;
  }

  return `Request additional verification before funding or releasing ${amountLabel}. This ${amountBand} invoice plus ${historySignal} should require manual approval and dispute readiness.`;
}

function fallbackRiskScore(amount, history = []) {
  const numericAmount = Number(amount || 0);
  const latePayments = history.filter((item) => item.status === "late").length;
  const disputedPayments = history.filter((item) => item.status === "disputed").length;
  const averageHistoryAmount = history.length
    ? history.reduce((sum, item) => sum + Number(item.amount || 0), 0) / history.length
    : 10000;
  const amountPressure = Math.min(58, Math.round(Math.log10(numericAmount + 1) * 9));
  const relativePressure = Math.min(18, Math.round((numericAmount / Math.max(averageHistoryAmount, 1)) * 8));
  const microInvoiceDiscount = numericAmount < 100 ? -4 : numericAmount < 500 ? -1 : 0;
  const largeInvoicePenalty = numericAmount >= 50000 ? 12 : numericAmount >= 25000 ? 7 : numericAmount >= 10000 ? 3 : 0;
  const score = Math.max(
    1,
    Math.min(
      95,
      4 + amountPressure + relativePressure + microInvoiceDiscount + largeInvoicePenalty + latePayments * 10 + disputedPayments * 22
    )
  );
  const riskLevel = score < 35 ? "Low" : score < 70 ? "Medium" : "High";

  return {
    risk_score: score,
    risk_level: riskLevel,
    recommendation: riskRecommendation({ amount: numericAmount, history, riskLevel }),
    analyzed_amount: numericAmount
  };
}

async function analyzeRisk({ amount, buyerHistory = [] }) {
  const deterministicRisk = fallbackRiskScore(amount, buyerHistory);

  if (!process.env.OPENAI_API_KEY) return deterministicRisk;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a B2B payments risk analyst. Return only JSON with risk_score number from 1-100, risk_level Low|Medium|High, and recommendation string. The score must be sensitive to the exact invoice amount; for example 22 USDC and 290 USDC should not receive the same score unless buyer history strongly justifies it."
        },
        {
          role: "user",
          content: JSON.stringify({
            amount: Number(amount || 0),
            buyer_transaction_history: buyerHistory,
            fallback_reference_score: deterministicRisk.risk_score,
            instruction: "Mention the exact amount in the recommendation and make the score amount-specific."
          })
        }
      ],
      temperature: 0.2
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    const parsedScore = Number(parsed.risk_score);
    const score = Number.isFinite(parsedScore)
      ? Math.max(1, Math.min(95, Math.round((parsedScore + deterministicRisk.risk_score * 2) / 3)))
      : deterministicRisk.risk_score;
    const riskLevel = score < 35 ? "Low" : score < 70 ? "Medium" : "High";
    return {
      risk_score: score,
      risk_level: riskLevel,
      recommendation: riskRecommendation({ amount, history: buyerHistory, riskLevel }),
      analyzed_amount: Number(amount || 0)
    };
  } catch (error) {
    console.error("AI risk fallback:", error.message);
    return deterministicRisk;
  }
}

function getDodoClient() {
  const apiKey = process.env.DODO_API_KEY || process.env.DODO_PAYMENTS_API_KEY;
  if (!apiKey) return null;
  return new DodoPayments({
    bearerToken: apiKey,
    environment: process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode",
    webhookKey: process.env.DODO_WEBHOOK_KEY || process.env.DODO_PAYMENTS_WEBHOOK_KEY || undefined
  });
}

function getDodoProductId() {
  return process.env.DODO_PRODUCT_ID || process.env.DODO_PAYMENTS_PRODUCT_ID;
}

async function createDodoCheckoutSession(invoice, requestUrl) {
  const client = getDodoClient();
  const productId = getDodoProductId();
  if (!client || !productId) throw new ApiError("Dodo Payments is not configured. Add DODO_API_KEY and DODO_PRODUCT_ID in Vercel.", 503);

  const amountMinor = Math.round(Number(invoice.amount || 0) * 100);
  const origin = new URL(requestUrl).origin;
  const payload = {
    product_cart: [{ product_id: productId, quantity: 1, amount: amountMinor }],
    allowed_payment_method_types: ["credit", "debit"],
    billing_address: { country: process.env.DODO_PAYMENTS_BILLING_COUNTRY || "US" },
    billing_currency: process.env.DODO_PAYMENTS_CURRENCY || "USD",
    return_url: `${origin}/dashboard?invoice_id=${invoice.id}&dodo_return=success`,
    cancel_url: `${origin}/dashboard?invoice_id=${invoice.id}&status=cancelled`,
    short_link: true,
    metadata: { invoice_id: invoice.id, invoice_amount: String(invoice.amount), buyer: invoice.buyer, seller: invoice.seller },
    customer: { email: `billing+${invoice.id.toLowerCase()}@settleflow.test`, name: invoice.buyer }
  };
  const session = await client.checkoutSessions.create(payload);
  console.log("Dodo checkout created", { invoiceId: invoice.id, amountMinor, sessionId: session.session_id || session.id });
  return {
    provider: "dodo",
    mode: process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode",
    sessionId: session.session_id || session.id,
    checkoutUrl: session.checkout_url || session.url,
    status: "checkout_created",
    intendedAmount: Number(invoice.amount),
    intendedAmountMinor: amountMinor,
    currency: process.env.DODO_PAYMENTS_CURRENCY || "USD"
  };
}

async function retrieveDodoCheckoutSession(sessionId) {
  const client = getDodoClient();
  if (!client) throw new ApiError("Dodo Payments is not configured. Add DODO_API_KEY in Vercel.", 503);
  return client.checkoutSessions.retrieve(sessionId);
}

function keypairFromSecret(secret) {
  if (!secret) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
}

function escrowKeypair() {
  return keypairFromSecret(process.env.STABLECOIN_ESCROW_SECRET_KEY);
}

function treasuryKeypair() {
  return keypairFromSecret(
    process.env.STABLECOIN_TREASURY_SECRET_KEY ||
    process.env.TREASURY_SECRET_KEY ||
    process.env.STABLECOIN_ESCROW_SECRET_KEY
  );
}

function requireStablecoinConfig() {
  const config = stablecoinConfig();
  if (!config.mint || !config.treasuryWallet) throw new ApiError("Solana USDC treasury is not configured.", 503);
  return config;
}

function anchorProgramId() {
  const value = process.env.ANCHOR_ESCROW_PROGRAM_ID || process.env.SETTLEFLOW_ESCROW_PROGRAM_ID;
  if (!value) {
    throw new ApiError("Anchor escrow is not configured. Add ANCHOR_ESCROW_PROGRAM_ID after deploying the SettleFlow Anchor program.", 503);
  }
  return new PublicKey(value);
}

function anchorDiscriminator(name) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function encodeAnchorString(value) {
  const bytes = Buffer.from(String(value), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function encodeAnchorU64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function anchorInstruction(name, keys, args = []) {
  return new TransactionInstruction({
    programId: anchorProgramId(),
    keys,
    data: Buffer.concat([anchorDiscriminator(name), ...args])
  });
}

async function anchorEscrowAccounts({ invoiceId, sellerWallet }) {
  const config = requireStablecoinConfig();
  const treasury = treasuryKeypair();
  if (!treasury) throw new ApiError("Treasury funding requires STABLECOIN_TREASURY_SECRET_KEY.", 503);

  const programId = anchorProgramId();
  const mint = new PublicKey(config.mint);
  const seller = new PublicKey(sellerWallet);
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(String(invoiceId)), treasury.publicKey.toBuffer()],
    programId
  );
  const treasuryTokenAccount = await getAssociatedTokenAddress(mint, treasury.publicKey);
  const vaultTokenAccount = await getAssociatedTokenAddress(mint, escrowPda, true);
  const sellerTokenAccount = await getAssociatedTokenAddress(mint, seller);

  return {
    config,
    treasury,
    mint,
    seller,
    escrowPda,
    treasuryTokenAccount,
    vaultTokenAccount,
    sellerTokenAccount
  };
}

async function initializeAndFundAnchorEscrow({ invoiceId, sellerWallet, amount }) {
  const accounts = await anchorEscrowAccounts({ invoiceId, sellerWallet });
  const connection = new Connection(accounts.config.rpcUrl, "confirmed");
  const lamports = await connection.getBalance(accounts.treasury.publicKey);

  if (lamports < 5000) {
    throw new ApiError(`Insufficient treasury SOL balance. Add devnet SOL for Anchor escrow fees: ${accounts.treasury.publicKey.toBase58()}`, 402);
  }

  const amountBaseUnits = Math.round(Number(amount) * 10 ** accounts.config.decimals);
  const treasuryBalance = await connection.getTokenAccountBalance(accounts.treasuryTokenAccount).catch(() => null);
  const availableBalance = Number(treasuryBalance?.value?.uiAmountString || treasuryBalance?.value?.uiAmount || 0);
  if (!treasuryBalance || availableBalance + Number.EPSILON < Number(amount)) {
    throw new ApiError(
      `Insufficient treasury USDC balance. Available ${availableBalance.toLocaleString()} USDC, required ${Number(amount || 0).toLocaleString()} USDC.`,
      402
    );
  }

  const transaction = new Transaction();
  const vaultInfo = await connection.getAccountInfo(accounts.vaultTokenAccount);
  if (!vaultInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        accounts.treasury.publicKey,
        accounts.vaultTokenAccount,
        accounts.escrowPda,
        accounts.mint
      )
    );
  }

  transaction.add(
    anchorInstruction("initialize_escrow", [
      { pubkey: accounts.escrowPda, isSigner: false, isWritable: true },
      { pubkey: accounts.treasury.publicKey, isSigner: true, isWritable: true },
      { pubkey: accounts.seller, isSigner: false, isWritable: false },
      { pubkey: accounts.mint, isSigner: false, isWritable: false },
      { pubkey: accounts.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ], [encodeAnchorString(invoiceId), encodeAnchorU64(amountBaseUnits)]),
    anchorInstruction("fund_escrow", [
      { pubkey: accounts.escrowPda, isSigner: false, isWritable: true },
      { pubkey: accounts.treasury.publicKey, isSigner: true, isWritable: true },
      { pubkey: accounts.mint, isSigner: false, isWritable: false },
      { pubkey: accounts.treasuryTokenAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ], [encodeAnchorU64(amountBaseUnits)])
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [accounts.treasury], { commitment: "confirmed" });
  console.log("Anchor escrow funded", { invoiceId, signature, escrow: accounts.escrowPda.toBase58(), vault: accounts.vaultTokenAccount.toBase58() });
  return {
    signature,
    escrowAccount: accounts.escrowPda.toBase58(),
    vaultTokenAccount: accounts.vaultTokenAccount.toBase58(),
    treasuryTokenAccount: accounts.treasuryTokenAccount.toBase58(),
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  };
}

async function releaseAnchorEscrow({ invoiceId, sellerWallet }) {
  const accounts = await anchorEscrowAccounts({ invoiceId, sellerWallet });
  const connection = new Connection(accounts.config.rpcUrl, "confirmed");
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(anchorInstruction("release_escrow", [
      { pubkey: accounts.escrowPda, isSigner: false, isWritable: true },
      { pubkey: accounts.treasury.publicKey, isSigner: true, isWritable: false }
    ])),
    [accounts.treasury],
    { commitment: "confirmed" }
  );
  console.log("Anchor escrow released", { invoiceId, signature });
  return {
    signature,
    escrowAccount: accounts.escrowPda.toBase58(),
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  };
}

async function buildSellerWithdrawTransaction({ invoiceId, sellerWallet }) {
  const accounts = await anchorEscrowAccounts({ invoiceId, sellerWallet });
  const connection = new Connection(accounts.config.rpcUrl, "confirmed");
  const transaction = new Transaction();
  const sellerInfo = await connection.getAccountInfo(accounts.sellerTokenAccount);

  if (!sellerInfo) {
    transaction.add(createAssociatedTokenAccountInstruction(accounts.seller, accounts.sellerTokenAccount, accounts.seller, accounts.mint));
  }

  transaction.add(anchorInstruction("withdraw_funds", [
    { pubkey: accounts.escrowPda, isSigner: false, isWritable: true },
    { pubkey: accounts.seller, isSigner: true, isWritable: false },
    { pubkey: accounts.mint, isSigner: false, isWritable: false },
    { pubkey: accounts.vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.sellerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
  ]));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = accounts.seller;
  transaction.recentBlockhash = blockhash;

  return {
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    sellerWallet: accounts.seller.toBase58(),
    sellerTokenAccount: accounts.sellerTokenAccount.toBase58(),
    escrowAccount: accounts.escrowPda.toBase58(),
    vaultTokenAccount: accounts.vaultTokenAccount.toBase58(),
    lastValidBlockHeight
  };
}

async function confirmSellerWithdrawTransaction({ invoice, signature, sellerWallet }) {
  if (!signature) throw new ApiError("signature is required", 400);
  const expectedSeller = String(invoice.seller_wallet || invoice.seller_payout?.sellerWallet || "").trim();
  if (!expectedSeller) throw new ApiError("Seller Solana wallet is missing.", 400);
  if (sellerWallet && sellerWallet !== expectedSeller) throw new ApiError("Connected wallet does not match this invoice seller wallet.", 403);

  const accounts = await anchorEscrowAccounts({ invoiceId: invoice.id, sellerWallet: expectedSeller });
  const connection = new Connection(accounts.config.rpcUrl, "confirmed");
  const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const value = status.value?.[0];

  if (!value) {
    throw new ApiError("Withdrawal transaction was not found on Devnet yet. Wait a few seconds and try confirming again.", 400);
  }

  if (value.err) {
    throw new ApiError(`Withdrawal transaction failed on-chain: ${JSON.stringify(value.err)}`, 400);
  }

  if (!["confirmed", "finalized"].includes(value.confirmationStatus)) {
    throw new ApiError("Withdrawal transaction is not confirmed yet. Wait a few seconds and try again.", 400);
  }

  const now = new Date().toISOString();
  const updated = await updateInvoice(invoice.id, (current) => transitionInvoiceStatus(current, PAYMENT_STATES.WITHDRAWN, {
    completed_at: current.completed_at || now,
    withdrawn_at: current.withdrawn_at || now,
    fiat_escrow: {
      ...(current.fiat_escrow || {}),
      status: PAYMENT_STATES.WITHDRAWN,
      withdrawalTx: signature,
      withdrawalExplorerUrl: explorerUrl(signature),
      withdrawnAt: now,
      updatedAt: now
    },
    seller_payout: {
      ...(current.seller_payout || {}),
      provider: "anchor_usdc",
      status: PAYMENT_STATES.WITHDRAWN,
      amount: Number(current.amount || 0),
      currency: current.currency || "USDC",
      sellerWallet: expectedSeller,
      reference: signature,
      note: "Seller withdrew USDC from the Anchor escrow vault.",
      createdAt: current.seller_payout?.createdAt || now,
      paidAt: now,
      updatedAt: now,
      tx: signature,
      explorerUrl: explorerUrl(signature),
      destinationTokenAccount: accounts.sellerTokenAccount.toBase58()
    },
    stablecoin: {
      ...(current.stablecoin || {}),
      status: PAYMENT_STATES.WITHDRAWN,
      sellerWallet: expectedSeller,
      withdrawalTx: signature,
      withdrawalExplorerUrl: explorerUrl(signature),
      escrowAccount: accounts.escrowPda.toBase58(),
      vaultTokenAccount: accounts.vaultTokenAccount.toBase58(),
      destinationTokenAccount: accounts.sellerTokenAccount.toBase58(),
      mode: "seller_signed_anchor_withdrawal"
    }
  }));

  await recordInvoiceEvent(updated, "withdrawn", `Seller signed withdrawal from Anchor escrow vault. Tx ${signature}.`).catch((error) => console.warn("Withdrawal event skipped:", error.message));
  await notifyInvoiceEvent(updated, "withdrawn").catch((error) => console.warn("Withdrawal email skipped:", error.message));
  return withPaymentPlan(updated);
}

async function requireAuth(headers) {
  const header = headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new ApiError("Login required before making transactions.", 401);

  const signedUser = verifySessionToken(token);
  if (signedUser?.id) {
    const activeUser = await findUserByEmail(signedUser.email);
    if (!activeUser || activeUser.id !== signedUser.id) {
      throw new ApiError("Session expired. Please log in again.", 401);
    }

    return publicUser(activeUser);
  }

  throw new ApiError("Session expired. Please log in again.", 401);
}

function getOwnedInvoice(invoices, id, userId) {
  return invoices.find((invoice) => invoice.id === id && invoice.ownerUserId === userId);
}

async function jsonBody(request) {
  return request.json().catch(() => ({}));
}

export async function handleSettleFlowApi(request, segments = []) {
  const method = request.method;
  const route = `/${segments.join("/")}`;
  console.log("API request", { method, route });

  if (method === "GET" && route === "/stablecoin/config") {
    const config = stablecoinConfig();
    const treasury = await getTreasuryLiquidity().catch(() => null);
    return {
      configured: Boolean(config.mint && config.treasuryWallet && (process.env.ANCHOR_ESCROW_PROGRAM_ID || process.env.SETTLEFLOW_ESCROW_PROGRAM_ID)),
      anchorProgramId: process.env.ANCHOR_ESCROW_PROGRAM_ID || process.env.SETTLEFLOW_ESCROW_PROGRAM_ID || "",
      treasury: treasury
        ? {
            wallet: treasury.treasuryWallet,
            tokenAccount: treasury.tokenAccount,
            mint: treasury.mint,
            sol: treasury.sol,
            usdc: treasury.usdc
          }
        : null,
      ...config
    };
  }

  if (method === "GET" && segments[0] === "invoice" && segments[1] === "track" && segments[2]) {
    const invoices = await readInvoices();
    const invoice = invoices.find((item) => item.tracking_token === segments[2] || item.share_token === segments[2]);
    if (!invoice) throw new ApiError("Invoice tracking link not found", 404);
    return publicInvoice(invoice);
  }

  if (method === "POST" && segments[0] === "invoice" && segments[1] === "track" && segments[2] && segments[3] === "withdraw" && segments[4] === "prepare") {
    const { sellerWallet } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = invoices.find((item) => item.tracking_token === segments[2] || item.share_token === segments[2]);
    if (!invoice) throw new ApiError("Invoice tracking link not found", 404);
    if (normalizePaymentState(invoice.status) !== PAYMENT_STATES.RELEASED) throw new ApiError("Buyer must release escrow before seller withdrawal.", 400);
    const expectedSeller = String(invoice.seller_wallet || invoice.seller_payout?.sellerWallet || "").trim();
    if (!sellerWallet || sellerWallet !== expectedSeller) throw new ApiError("Connect the seller wallet assigned to this invoice.", 403);
    return buildSellerWithdrawTransaction({ invoiceId: invoice.id, sellerWallet });
  }

  if (method === "POST" && segments[0] === "invoice" && segments[1] === "track" && segments[2] && segments[3] === "withdraw" && segments[4] === "confirm") {
    const { signature, sellerWallet } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = invoices.find((item) => item.tracking_token === segments[2] || item.share_token === segments[2]);
    if (!invoice) throw new ApiError("Invoice tracking link not found", 404);
    return publicInvoice(await confirmSellerWithdrawTransaction({ invoice, signature, sellerWallet }));
  }

  if (method === "POST" && route === "/ai/risk") {
    const body = await jsonBody(request);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError("valid amount is required", 400);
    return { ...(await analyzeRisk({ amount, buyerHistory: body.buyerHistory || mockBuyerHistory })), generated_at: new Date().toISOString() };
  }

  if (method === "POST" && route === "/auth/signup") {
    const { name, email, password, company = "" } = await jsonBody(request);
    if (!name || !email || !password) throw new ApiError("name, email, and password are required", 400);
    if (password.length < 6) throw new ApiError("password must be at least 6 characters", 400);
    const normalizedEmail = normalizeEmail(email);
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      throw new ApiError("An account with this email already exists. Please log in instead.", 409);
    }

    const user = {
      id: userIdFromEmail(normalizedEmail),
      name,
      email: normalizedEmail,
      company,
      passwordHash: hashPassword(password),
      sessionTokens: [],
      createdAt: new Date().toISOString()
    };
    const savedUser = await createUser(user);
    return { user: publicUser(savedUser), token: signSessionToken(savedUser) };
  }

  if (method === "POST" && route === "/auth/dev/clear") {
    const { confirmation } = await jsonBody(request);
    if (process.env.ALLOW_AUTH_CLEAR !== "true") {
      throw new ApiError("Auth clearing is disabled. Set ALLOW_AUTH_CLEAR=true temporarily for testing.", 403);
    }
    if (confirmation !== "CLEAR_LOGIN_DATA") {
      throw new ApiError("confirmation must be CLEAR_LOGIN_DATA", 400);
    }

    const result = await clearAllAuthData();
    return {
      cleared: true,
      message: result.skipped.length
        ? `Browser/local test login data cleared. Supabase tables missing: ${result.skipped.join(", ")}. Run frontend/supabase/schema.sql in Supabase SQL Editor.`
        : "All SettleFlow test users and invoices were cleared."
    };
  }

  if (method === "POST" && route === "/auth/login") {
    const { email, password } = await jsonBody(request);
    if (!email || !password) throw new ApiError("email and password are required", 400);
    const normalizedEmail = normalizeEmail(email);
    const user = await findUserByEmail(normalizedEmail);

    if (!user) {
      throw new ApiError("No account found with this email. Please create an account first.", 404);
    }

    const passwordMatches = user ? verifyPassword(password, user.passwordHash) : false;
    if (!passwordMatches) throw new ApiError("Incorrect password. Please try again or use forgot password.", 401);
    user.id = user.id || userIdFromEmail(normalizedEmail);
    if (user.passwordHash === password) {
      user.passwordHash = hashPassword(password);
    }
    const savedUser = await saveUser(user);
    return { user: publicUser(savedUser), token: signSessionToken(savedUser) };
  }

  if (method === "POST" && route === "/auth/forgot-password") {
    const { email } = await jsonBody(request);
    const user = await findUserByEmail(email);
    if (!user) return { message: "If an account exists, a reset code was generated." };
    user.resetCode = String(crypto.randomInt(100000, 999999));
    user.resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await saveUser(user);
    const emailResult = await sendResetCodeEmail({
      email: user.email,
      code: user.resetCode,
      name: user.name
    });

    return {
      message: emailResult.sent
        ? "Password reset code sent to your email."
        : "Password reset code generated. Add RESEND_API_KEY to send it by email.",
      resetCode: emailResult.sent ? undefined : user.resetCode
    };
  }

  if (method === "POST" && route === "/auth/reset-password") {
    const { email, resetCode, password } = await jsonBody(request);
    if (!email || !resetCode || !password) throw new ApiError("email, reset code, and password are required", 400);
    const user = await findUserByEmail(email);
    if (!user || user.resetCode !== resetCode || new Date(user.resetCodeExpiresAt) < new Date()) throw new ApiError("Invalid or expired reset code", 400);
    user.passwordHash = hashPassword(password);
    user.sessionTokens = [];
    delete user.resetCode;
    delete user.resetCodeExpiresAt;
    await saveUser(user);
    return { message: "Password reset. Please log in again." };
  }

  if (method === "POST" && route === "/webhook") {
    const rawBody = await request.text();
    const client = getDodoClient();
    const webhookKey = process.env.DODO_WEBHOOK_KEY || process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    let payload = parseJsonSafely(rawBody);
    let verified = false;

    if (client && webhookKey) {
      try {
        payload = client.webhooks.unwrap(rawBody, {
          headers: {
            "webhook-id": request.headers.get("webhook-id"),
            "webhook-signature": request.headers.get("webhook-signature"),
            "webhook-timestamp": request.headers.get("webhook-timestamp")
          }
        });
        verified = true;
      } catch (error) {
        console.warn("Dodo webhook signature verification failed:", error.message);

        if (dodoWebhookStrict()) {
          throw new ApiError("Invalid Dodo webhook signature", 401);
        }
      }
    }

    const { data, invoiceId, paymentStatus, paymentId } = extractDodoWebhookData(payload);
    console.log("Dodo webhook event", {
      type: payload.type || payload.event_type || payload.event,
      invoiceId,
      paymentStatus,
      paymentId,
      verified
    });

    if (invoiceId) {
      const updated = await updateInvoice(invoiceId, (invoice) => applyDodoPaymentStatus(invoice, paymentStatus, { ...data, paymentId }));
      if (normalizePaymentState(updated?.status) === PAYMENT_STATES.FIAT_PAID) {
        await recordInvoiceEvent(updated, "fiat_paid", `Dodo fiat payment confirmed for ${Number(updated.amount || 0).toLocaleString()} ${updated.currency || "USDC"}.`).catch((error) => console.warn("Webhook fiat-paid event skipped:", error.message));
        await fundTreasuryEscrowForInvoice(invoiceId, { source: "automatic" }).catch(async (error) => {
          console.error("Automatic treasury escrow funding failed:", error);
          await recordInvoiceEvent(updated, "treasury_funding_failed", error.message || "Automatic treasury escrow funding failed.").catch((eventError) => console.warn("Treasury funding failure event skipped:", eventError.message));
        });
      }
    }

    return { received: true };
  }

  const user = await requireAuth(request.headers);

  if (method === "GET" && route === "/invoice/all") {
    const invoices = await readInvoices();
    return invoices.filter((invoice) => invoice.ownerUserId === user.id && invoice.id).map(withPaymentPlan);
  }

  if (method === "GET" && segments[0] === "invoice" && segments[1]) {
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, segments[1], user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    return withPaymentPlan(invoice);
  }

  if (method === "POST" && route === "/invoice/import") {
    const body = await jsonBody(request);
    const incoming = Array.isArray(body.invoices) ? body.invoices : [];
    const ownedIncoming = incoming
      .filter((invoice) => invoice?.id)
      .map((invoice) => ({
        ...invoice,
        ownerUserId: user.id,
        source: invoice.source || "client_restore"
      }));
    const invoices = await readInvoices();
    const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    for (const invoice of ownedIncoming) {
      byId.set(invoice.id, {
        ...(byId.get(invoice.id) || {}),
        ...invoice
      });
    }

    const merged = Array.from(byId.values());
    await writeInvoices(merged);
    console.log("Imported client invoice backup", { userId: user.id, count: ownedIncoming.length });
    return merged.filter((invoice) => invoice.ownerUserId === user.id && invoice.id).map(withPaymentPlan);
  }

  if (method === "GET" && route === "/analytics/summary") {
    const invoices = await readInvoices();
    return buildAnalytics(invoices.filter((invoice) => invoice.ownerUserId === user.id));
  }

  if (method === "POST" && route === "/invoice/create") {
    const {
      title = "Escrow protected invoice",
      description = "",
      amount,
      buyer,
      seller,
      buyer_email = "",
      seller_email = "",
      seller_wallet = "",
      due_date = null,
      allow_partial_funding = true,
      upfront_percentage,
      payment_method = "dodo"
    } = await jsonBody(request);
    if (!amount || !buyer || !seller) throw new ApiError("amount, buyer, and seller are required", 400);
    if (!String(seller_wallet || "").trim()) throw new ApiError("seller_wallet is required for on-chain escrow withdrawal", 400);
    const risk = await analyzeRisk({ amount: Number(amount), buyerHistory: mockBuyerHistory });
    const config = stablecoinConfig();
    const invoice = {
      id: `INV-${nanoid(6).toUpperCase()}`,
      settleflow_id: `SF-${nanoid(8).toUpperCase()}`,
      tracking_token: nanoid(24),
      share_token: nanoid(24),
      source: "user",
      ownerUserId: user.id,
      owner_email: normalizeEmail(user.email),
      amount: Number(amount),
      currency: "USDC",
      title,
      description,
      buyer,
      seller,
      buyer_email: normalizeEmail(buyer_email),
      seller_email: normalizeEmail(seller_email),
      seller_wallet,
      due_date,
      allow_partial_funding: Boolean(allow_partial_funding),
      escrow_enabled: true,
      milestones: [],
      payment_method: "dodo",
      status: PAYMENT_STATES.DRAFT,
      upfront_percentage: normalizeUpfrontPercentage(upfront_percentage),
      upfront_paid: false,
      remaining_paid: false,
      paid_amount: 0,
      funded_at: null,
      completed_at: null,
      fiat_paid_at: null,
      treasury_funding_started_at: null,
      escrow_funded_at: null,
      work_submitted_at: null,
      released_at: null,
      withdrawn_at: null,
      risk,
      payment: { provider: "dodo", status: PAYMENT_STATES.DRAFT, sessionId: null, checkoutUrl: null, paymentId: null, mode: "unconfigured" },
      seller_payout: {
        provider: "anchor_usdc",
        status: PAYMENT_STATES.DRAFT,
        amount: 0,
        currency: "USDC",
        reference: null,
        note: "",
        createdAt: null,
        paidAt: null,
        updatedAt: null
      },
      fiat_escrow: {
        status: PAYMENT_STATES.DRAFT,
        treasuryTx: null,
        treasuryExplorerUrl: null,
        withdrawalTx: null,
        withdrawalExplorerUrl: null,
        fundedAt: null,
        withdrawnAt: null,
        updatedAt: null
      },
      stablecoin: { chain: config.chain, token: config.symbol, mint: config.mint, status: PAYMENT_STATES.DRAFT, amount: Number(amount), escrowTx: null, releaseTx: null, mode: "anchor_pda" },
      createdAt: new Date().toISOString()
    };
    const invoices = await readInvoices();
    invoices.unshift(invoice);
    await writeInvoices(invoices);
    await notifyInvoiceEvent(invoice, "created", request.url).catch((error) => console.warn("Invoice created email skipped:", error.message));
    return withPaymentPlan(invoice);
  }

  if (method === "DELETE" && segments[0] === "invoice" && segments[1]) {
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, segments[1], user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);

    const supabase = supabaseClient();

    if (supabase) {
      const { error } = await supabase
        .from(APP_INVOICES_TABLE)
        .delete()
        .eq("id", segments[1])
        .eq("owner_user_id", user.id);

      if (error) {
        throw new ApiError(`Unable to delete invoice: ${supabaseErrorMessage(error)}`, 500);
      }

      await supabase.from("invoices").delete().eq("id", segments[1]);
    } else {
      await writeInvoices(invoices.filter((item) => item.id !== segments[1]));
    }

    return { deleted: true, id: segments[1] };
  }

  if (method === "POST" && route === "/invoice/checkout") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (![PAYMENT_STATES.DRAFT, PAYMENT_STATES.CHECKOUT_PENDING].includes(normalizePaymentState(invoice.status))) {
      throw new ApiError(`Checkout cannot be created while invoice is ${normalizePaymentState(invoice.status)}.`, 409);
    }
    await assertTreasuryLiquidityForCheckout(invoice.amount);
    const checkout = await createDodoCheckoutSession(invoice, request.url);
    const now = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => transitionInvoiceStatus(current, PAYMENT_STATES.CHECKOUT_PENDING, {
      payment: { ...(current.payment || {}), ...checkout, createdAt: now },
      checkout_created_at: now
    }));
    return { invoice: withPaymentPlan(updated), checkout };
  }

  if (method === "POST" && route === "/invoice/share") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    const token = invoice.tracking_token || nanoid(24);
    const shareToken = invoice.share_token || token;
    const updated = await updateInvoice(id, (current) => ({
      ...current,
      tracking_token: current.tracking_token || token,
      share_token: current.share_token || shareToken
    }));
    const origin = new URL(request.url).origin;
    return {
      invoice: withPaymentPlan(updated),
      trackingUrl: `${origin}/invoice/${updated.share_token || updated.tracking_token}`
    };
  }

  if (method === "POST" && route === "/invoice/payment/sync") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (!invoice.payment?.sessionId) throw new ApiError("Invoice does not have a Dodo checkout session yet", 400);
    const session = await retrieveDodoCheckoutSession(invoice.payment.sessionId);
    const paymentStatus = session.payment_status || session.status || "processing";
    const updated = await updateInvoice(id, (current) => applyDodoPaymentStatus(current, paymentStatus, session));
    if ([PAYMENT_STATES.FIAT_PAID, PAYMENT_STATES.TREASURY_FUNDING_PENDING].includes(normalizePaymentState(updated.status))) {
      await recordInvoiceEvent(updated, "fiat_paid", `Dodo fiat payment collected for ${Number(updated.amount || 0).toLocaleString()} ${updated.currency || "USDC"}.`).catch((error) => console.warn("Fiat payment event skipped:", error.message));
      let fundingError = null;
      const funded = await fundTreasuryEscrowForInvoice(id, { userId: user.id, source: "automatic" }).catch(async (error) => {
        fundingError = error;
        await recordInvoiceEvent(updated, "treasury_funding_failed", error.message || "Automatic treasury escrow funding failed.").catch((eventError) => console.warn("Treasury funding failure event skipped:", eventError.message));
        return null;
      });
      if (funded) {
        return { invoice: funded, session };
      }
      if (fundingError) {
        const latestInvoices = await readInvoices();
        const latest = getOwnedInvoice(latestInvoices, id, user.id) || updated;
        return { invoice: withPaymentPlan(latest), session };
      }
    }
    return { invoice: withPaymentPlan(updated), session };
  }

  if (method === "POST" && route === "/treasury/fund-escrow") {
    const { id } = await jsonBody(request);
    return fundTreasuryEscrowForInvoice(id, { userId: user.id, source: "manual_retry" });
  }

  if (method === "POST" && route === "/escrow/release") {
    const { id } = await jsonBody(request);
    if (!id) throw new ApiError("invoice id is required", 400);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (normalizePaymentState(invoice.status) !== PAYMENT_STATES.ESCROW_FUNDED && normalizePaymentState(invoice.status) !== PAYMENT_STATES.WORK_SUBMITTED) {
      throw new ApiError("Escrow must be funded before buyer can release funds.", 400);
    }
    const sellerWallet = String(invoice.seller_wallet || invoice.seller_payout?.sellerWallet || "").trim();
    if (!sellerWallet) throw new ApiError("Seller Solana wallet is missing.", 400);
    new PublicKey(sellerWallet);

    const release = await releaseAnchorEscrow({ invoiceId: invoice.id, sellerWallet });
    const now = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => transitionInvoiceStatus(current, PAYMENT_STATES.RELEASED, {
      released_at: current.released_at || now,
      fiat_escrow: {
        ...(current.fiat_escrow || {}),
        status: PAYMENT_STATES.RELEASED,
        releaseTx: release.signature,
        releaseExplorerUrl: release.explorerUrl,
        updatedAt: now
      },
      seller_payout: {
        ...(current.seller_payout || {}),
        provider: "anchor_usdc",
        status: PAYMENT_STATES.RELEASED,
        amount: Number(current.amount || 0),
        currency: current.currency || "USDC",
        sellerWallet,
        reference: release.signature,
        note: "Buyer released the Anchor escrow. Seller withdrawal is now available.",
        createdAt: current.seller_payout?.createdAt || now,
        updatedAt: now,
        tx: release.signature,
        explorerUrl: release.explorerUrl
      },
      stablecoin: {
        ...(current.stablecoin || {}),
        status: PAYMENT_STATES.RELEASED,
        sellerWallet,
        releaseTx: release.signature,
        releaseExplorerUrl: release.explorerUrl,
        escrowAccount: release.escrowAccount,
        mode: "anchor_release"
      }
    }));
    await recordInvoiceEvent(updated, "released", `Buyer released Anchor escrow. Tx ${release.signature}.`).catch((error) => console.warn("Release event skipped:", error.message));
    return withPaymentPlan(updated);
  }

  if (method === "POST" && route === "/freelancer/withdraw/prepare") {
    const { id, sellerWallet } = await jsonBody(request);
    if (!id) throw new ApiError("invoice id is required", 400);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (normalizePaymentState(invoice.status) !== PAYMENT_STATES.RELEASED) throw new ApiError("Buyer must release escrow before seller withdrawal.", 400);
    const expectedSeller = String(invoice.seller_wallet || invoice.seller_payout?.sellerWallet || "").trim();
    if (!sellerWallet || sellerWallet !== expectedSeller) throw new ApiError("Connect the seller wallet assigned to this invoice.", 403);
    return buildSellerWithdrawTransaction({ invoiceId: invoice.id, sellerWallet });
  }

  if (method === "POST" && route === "/freelancer/withdraw/confirm") {
    const { id, signature, sellerWallet } = await jsonBody(request);
    if (!id) throw new ApiError("invoice id is required", 400);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    return confirmSellerWithdrawTransaction({ invoice, signature, sellerWallet });
  }

  throw new ApiError(`Route ${method} ${route} not found`, 404);
}

export function apiErrorResponse(error) {
  console.error("API error:", error);
  return Response.json({ error: error.message || "Unexpected server error" }, { status: error.status || 500 });
}
