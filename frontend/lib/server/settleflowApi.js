import crypto from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import DodoPayments from "dodopayments";
import { nanoid } from "nanoid";
import OpenAI from "openai";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";

const DATA_DIR = process.env.SETTLEFLOW_DATA_DIR || (process.env.VERCEL ? "/tmp/settleflow" : path.join(process.cwd(), "data"));
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

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

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    throw error;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, storedPassword = "") {
  const [iterations, salt, storedHash] = storedPassword.split(":");
  if (!iterations || !salt || !storedHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
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

async function readInvoices() {
  return readJson(INVOICES_FILE, []);
}

async function writeInvoices(invoices) {
  await writeJson(INVOICES_FILE, invoices);
}

async function readUsers() {
  return readJson(USERS_FILE, []);
}

async function writeUsers(users) {
  await writeJson(USERS_FILE, users);
}

async function updateInvoice(id, updater) {
  const invoices = await readInvoices();
  const index = invoices.findIndex((invoice) => invoice.id === id);
  if (index === -1) return null;
  invoices[index] = updater(invoices[index]);
  await writeInvoices(invoices);
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
  const upfrontPaid = Boolean(invoice.upfront_paid);
  const remainingPaid = Boolean(invoice.remaining_paid || invoice.status === "Completed");
  const paidAmount = Number((upfrontPaid ? upfrontAmount : 0) + (remainingPaid ? remainingAmount : 0));

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
  return {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    chain: process.env.STABLECOIN_CHAIN || "solana-devnet",
    symbol: process.env.STABLECOIN_SYMBOL || "USDC",
    mint: process.env.STABLECOIN_MINT_ADDRESS || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    escrowWallet: process.env.STABLECOIN_ESCROW_WALLET || signer?.publicKey.toBase58() || "",
    decimals: Number(process.env.STABLECOIN_DECIMALS || 6)
  };
}

function withPaymentPlan(invoice) {
  const amount = Number(invoice.amount || 0);
  const config = stablecoinConfig();
  return {
    ...invoice,
    amount,
    currency: invoice.currency || "USDC",
    status: invoice.status || "Pending",
    buyer: invoice.buyer || "Unknown buyer",
    seller: invoice.seller || "Unknown seller",
    risk: invoice.risk || {
      risk_score: 0,
      risk_level: "Low",
      recommendation: "Risk analysis has not been generated for this invoice yet."
    },
    payment: invoice.payment || {
      provider: "dodo",
      status: "not_started",
      sessionId: null,
      checkoutUrl: null,
      paymentId: null,
      mode: "unconfigured"
    },
    stablecoin: invoice.stablecoin || {
      chain: config.chain,
      token: config.symbol,
      mint: config.mint,
      status: "not_started",
      amount,
      escrowTx: null,
      releaseTx: null,
      mode: "real_spl"
    },
    ...getPaymentPlan(invoice)
  };
}

function buildAnalytics(invoices) {
  const completed = invoices.filter((invoice) => invoice.status === "Completed");
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

function fallbackRiskScore(amount, history = []) {
  const numericAmount = Number(amount || 0);
  const latePayments = history.filter((item) => item.status === "late").length;
  const disputedPayments = history.filter((item) => item.status === "disputed").length;
  const amountPressure = Math.min(50, Math.floor(numericAmount / 2000));
  const score = Math.min(95, 10 + amountPressure + (numericAmount >= 50000 ? 12 : numericAmount >= 25000 ? 6 : 0) + latePayments * 12 + disputedPayments * 24);
  const riskLevel = score < 35 ? "Low" : score < 70 ? "Medium" : "High";
  return {
    risk_score: score,
    risk_level: riskLevel,
    recommendation: `${riskLevel === "Low" ? "Approve" : riskLevel === "Medium" ? "Review" : "Request verification before"} escrow for ${numericAmount.toLocaleString()} USDC.`,
    analyzed_amount: numericAmount
  };
}

async function analyzeRisk({ amount, buyerHistory = [] }) {
  if (!process.env.OPENAI_API_KEY) return fallbackRiskScore(amount, buyerHistory);
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON with risk_score number, risk_level Low|Medium|High, and recommendation string." },
        { role: "user", content: JSON.stringify({ amount: Number(amount || 0), buyer_transaction_history: buyerHistory }) }
      ],
      temperature: 0.2
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      risk_score: Math.max(0, Math.min(100, Math.round(Number(parsed.risk_score || 0)))),
      risk_level: ["Low", "Medium", "High"].includes(parsed.risk_level) ? parsed.risk_level : "Low",
      recommendation: parsed.recommendation || fallbackRiskScore(amount, buyerHistory).recommendation,
      analyzed_amount: Number(amount || 0)
    };
  } catch (error) {
    console.error("AI risk fallback:", error.message);
    return fallbackRiskScore(amount, buyerHistory);
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
    return_url: `${origin}/dashboard?invoice_id=${invoice.id}`,
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

function escrowKeypair() {
  if (!process.env.STABLECOIN_ESCROW_SECRET_KEY) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.STABLECOIN_ESCROW_SECRET_KEY)));
}

function requireStablecoinConfig() {
  const config = stablecoinConfig();
  if (!config.mint || !config.escrowWallet) throw new ApiError("Solana USDC is not configured.", 503);
  return config;
}

async function verifyStablecoinTransfer({ signature, expectedBuyer, expectedAmount }) {
  const config = requireStablecoinConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) throw new ApiError("Transaction was not found or is not confirmed yet.", 400);
  if (tx.meta?.err) throw new ApiError("Transaction failed on-chain.", 400);

  const expectedMint = new PublicKey(config.mint).toBase58();
  const expectedOwner = new PublicKey(expectedBuyer).toBase58();
  const expectedDestinationOwner = new PublicKey(config.escrowWallet).toBase58();
  const expectedUiAmount = Number(expectedAmount);
  let matchedDestinationTokenAccount = "";
  const transfer = tx.transaction.message.instructions.find((instruction) => {
    if (!("parsed" in instruction) || instruction.program !== "spl-token") return false;
    const info = instruction.parsed?.info || {};
    const tokenAmount = info.tokenAmount || {};
    const uiAmount = Number(tokenAmount.uiAmountString || info.amount || 0);
    const destination = info.destination;
    const destinationBalance = tx.meta?.postTokenBalances?.find((balance) => {
      const accountKey = tx.transaction.message.accountKeys[balance.accountIndex]?.pubkey?.toBase58();
      return accountKey === destination;
    });
    const matched = ["transfer", "transferChecked"].includes(instruction.parsed?.type) &&
      info.mint === expectedMint &&
      info.authority === expectedOwner &&
      destinationBalance?.owner === expectedDestinationOwner &&
      Math.abs(uiAmount - expectedUiAmount) < 0.000001;
    if (matched) matchedDestinationTokenAccount = destination;
    return matched;
  });
  if (!transfer) throw new ApiError("Transaction does not match the expected USDC escrow transfer.", 400);
  console.log("USDC escrow verified", { signature, expectedAmount, buyer: expectedBuyer });
  return {
    signature,
    slot: tx.slot,
    chain: config.chain,
    token: config.symbol,
    mint: expectedMint,
    escrowWallet: expectedDestinationOwner,
    escrowTokenAccount: matchedDestinationTokenAccount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  };
}

async function escrowTokenBalance() {
  const config = requireStablecoinConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(config.mint);
  const escrowOwner = new PublicKey(config.escrowWallet);
  const escrowAta = await getAssociatedTokenAddress(mint, escrowOwner);
  try {
    const balance = await connection.getTokenAccountBalance(escrowAta);
    return { tokenAccount: escrowAta.toBase58(), uiAmount: Number(balance.value.uiAmountString || 0) };
  } catch {
    return { tokenAccount: escrowAta.toBase58(), uiAmount: 0 };
  }
}

async function releaseStablecoinTransfer({ sellerWallet, amount }) {
  const config = requireStablecoinConfig();
  const signer = escrowKeypair();
  if (!signer) throw new ApiError("USDC release requires STABLECOIN_ESCROW_SECRET_KEY in Vercel.", 503);
  if (signer.publicKey.toBase58() !== config.escrowWallet) throw new ApiError("STABLECOIN_ESCROW_SECRET_KEY does not match STABLECOIN_ESCROW_WALLET.", 503);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(config.mint);
  const seller = new PublicKey(sellerWallet);
  const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);
  const destinationAta = await getAssociatedTokenAddress(mint, seller);
  const sourceBalance = await connection.getTokenAccountBalance(sourceAta);
  if (Number(sourceBalance.value.uiAmountString || 0) < Number(amount)) throw new ApiError(`Escrow token account has ${sourceBalance.value.uiAmountString} USDC, but this invoice requires ${amount} USDC.`, 400);

  const transaction = new Transaction();
  const destinationInfo = await connection.getAccountInfo(destinationAta);
  if (!destinationInfo) transaction.add(createAssociatedTokenAccountInstruction(signer.publicKey, destinationAta, seller, mint));
  transaction.add(createTransferCheckedInstruction(sourceAta, mint, destinationAta, signer.publicKey, BigInt(Math.round(Number(amount) * 10 ** config.decimals)), config.decimals));
  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], { commitment: "confirmed" });
  console.log("USDC released", { signature, sellerWallet, amount });
  return {
    signature,
    sellerWallet,
    sourceTokenAccount: sourceAta.toBase58(),
    destinationTokenAccount: destinationAta.toBase58(),
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  };
}

async function requireAuth(headers) {
  const header = headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new ApiError("Login required before making transactions.", 401);
  const users = await readUsers();
  const user = users.find((item) => item.sessionTokens?.includes(token));
  if (!user) throw new ApiError("Session expired. Please log in again.", 401);
  return publicUser(user);
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
    return { configured: Boolean(config.mint && config.escrowWallet), ...config };
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
    const users = await readUsers();
    const normalizedEmail = email.toLowerCase().trim();
    if (users.some((user) => user.email === normalizedEmail)) throw new ApiError("An account with this email already exists", 409);
    const user = { id: `USR-${nanoid(8).toUpperCase()}`, name, email: normalizedEmail, company, passwordHash: hashPassword(password), sessionTokens: [`demo_${crypto.randomBytes(24).toString("hex")}`], createdAt: new Date().toISOString() };
    users.unshift(user);
    await writeUsers(users);
    return { user: publicUser(user), token: user.sessionTokens[0] };
  }

  if (method === "POST" && route === "/auth/login") {
    const { email, password } = await jsonBody(request);
    const users = await readUsers();
    const user = users.find((item) => item.email === email?.toLowerCase().trim());
    if (!user || !verifyPassword(password, user.passwordHash)) throw new ApiError("Invalid email or password", 401);
    const token = `demo_${crypto.randomBytes(24).toString("hex")}`;
    user.sessionTokens = [...(user.sessionTokens || []), token].slice(-5);
    await writeUsers(users);
    return { user: publicUser(user), token };
  }

  if (method === "POST" && route === "/auth/forgot-password") {
    const { email } = await jsonBody(request);
    const users = await readUsers();
    const user = users.find((item) => item.email === email?.toLowerCase().trim());
    if (!user) return { message: "If an account exists, a reset code was generated." };
    user.resetCode = String(crypto.randomInt(100000, 999999));
    user.resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await writeUsers(users);
    return { message: "Password reset code generated. In production this would be emailed.", resetCode: user.resetCode };
  }

  if (method === "POST" && route === "/auth/reset-password") {
    const { email, resetCode, password } = await jsonBody(request);
    if (!email || !resetCode || !password) throw new ApiError("email, reset code, and password are required", 400);
    const users = await readUsers();
    const user = users.find((item) => item.email === email.toLowerCase().trim());
    if (!user || user.resetCode !== resetCode || new Date(user.resetCodeExpiresAt) < new Date()) throw new ApiError("Invalid or expired reset code", 400);
    user.passwordHash = hashPassword(password);
    user.sessionTokens = [];
    delete user.resetCode;
    delete user.resetCodeExpiresAt;
    await writeUsers(users);
    return { message: "Password reset. Please log in again." };
  }

  if (method === "POST" && route === "/webhook") {
    const rawBody = await request.text();
    const client = getDodoClient();
    const webhookKey = process.env.DODO_WEBHOOK_KEY || process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    const payload = client && webhookKey
      ? client.webhooks.unwrap(rawBody, {
        headers: {
          "webhook-id": request.headers.get("webhook-id"),
          "webhook-signature": request.headers.get("webhook-signature"),
          "webhook-timestamp": request.headers.get("webhook-timestamp")
        }
      })
      : JSON.parse(rawBody || "{}");
    const data = payload.data || payload;
    const metadata = data.metadata || data.payment?.metadata || {};
    const invoiceId = metadata.invoice_id || data.invoice_id;
    const paymentStatus = data.payment_status || data.status || data.payment?.status;
    console.log("Dodo webhook event", { type: payload.type || payload.event_type || payload.event, invoiceId, paymentStatus });
    if (invoiceId) {
      await updateInvoice(invoiceId, (invoice) => ({
        ...invoice,
        status: paymentStatus === "succeeded" && invoice.status === "Pending" ? "Funded" : invoice.status,
        upfront_paid: paymentStatus === "succeeded" ? true : invoice.upfront_paid || false,
        remaining_paid: paymentStatus === "succeeded" ? true : invoice.remaining_paid || false,
        funded_at: paymentStatus === "succeeded" ? invoice.funded_at || new Date().toISOString() : invoice.funded_at || null,
        payment: { ...(invoice.payment || {}), provider: "dodo", status: paymentStatus || "webhook_received", paymentId: data.payment_id || data.id || data.payment?.id || null, updatedAt: new Date().toISOString() }
      }));
    }
    return { received: true };
  }

  const user = await requireAuth(request.headers);

  if (method === "GET" && route === "/invoice/all") {
    const invoices = await readInvoices();
    return invoices.filter((invoice) => invoice.ownerUserId === user.id && invoice.id).map(withPaymentPlan);
  }

  if (method === "GET" && route === "/analytics/summary") {
    const invoices = await readInvoices();
    return buildAnalytics(invoices.filter((invoice) => invoice.ownerUserId === user.id));
  }

  if (method === "POST" && route === "/invoice/create") {
    const { amount, buyer, seller, upfront_percentage } = await jsonBody(request);
    if (!amount || !buyer || !seller) throw new ApiError("amount, buyer, and seller are required", 400);
    const risk = await analyzeRisk({ amount: Number(amount), buyerHistory: mockBuyerHistory });
    const config = stablecoinConfig();
    const invoice = {
      id: `INV-${nanoid(6).toUpperCase()}`,
      source: "user",
      ownerUserId: user.id,
      amount: Number(amount),
      currency: "USDC",
      buyer,
      seller,
      status: "Pending",
      upfront_percentage: normalizeUpfrontPercentage(upfront_percentage),
      upfront_paid: false,
      remaining_paid: false,
      paid_amount: 0,
      funded_at: null,
      completed_at: null,
      risk,
      payment: { provider: "dodo", status: "not_started", sessionId: null, checkoutUrl: null, paymentId: null, mode: "unconfigured" },
      stablecoin: { chain: config.chain, token: config.symbol, mint: config.mint, status: "not_started", amount: Number(amount), escrowTx: null, releaseTx: null, mode: "real_spl" },
      createdAt: new Date().toISOString()
    };
    const invoices = await readInvoices();
    invoices.unshift(invoice);
    await writeInvoices(invoices);
    return withPaymentPlan(invoice);
  }

  if (method === "DELETE" && segments[0] === "invoice" && segments[1]) {
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, segments[1], user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    await writeInvoices(invoices.filter((item) => item.id !== segments[1]));
    return { deleted: true, id: segments[1] };
  }

  if (method === "POST" && route === "/invoice/checkout") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    const checkout = await createDodoCheckoutSession(invoice, request.url);
    const updated = await updateInvoice(id, (current) => ({ ...current, payment: { ...(current.payment || {}), ...checkout, createdAt: new Date().toISOString() } }));
    return { invoice: withPaymentPlan(updated), checkout };
  }

  if (method === "POST" && route === "/invoice/payment/sync") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (!invoice.payment?.sessionId) throw new ApiError("Invoice does not have a Dodo checkout session yet", 400);
    const session = await retrieveDodoCheckoutSession(invoice.payment.sessionId);
    const paymentStatus = session.payment_status || session.status || "processing";
    const updated = await updateInvoice(id, (current) => ({ ...current, status: paymentStatus === "succeeded" && current.status === "Pending" ? "Funded" : current.status, payment: { ...(current.payment || {}), status: paymentStatus, updatedAt: new Date().toISOString() } }));
    return { invoice: withPaymentPlan(updated), session };
  }

  if (method === "POST" && route === "/invoice/fund") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    if (!getOwnedInvoice(invoices, id, user.id)) throw new ApiError("Invoice not found", 404);
    const now = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => ({ ...current, status: "Funded", upfront_paid: true, remaining_paid: true, paid_amount: Number(current.amount || 0), funded_at: current.funded_at || now }));
    return withPaymentPlan(updated);
  }

  if (method === "POST" && route === "/invoice/release") {
    const { id } = await jsonBody(request);
    const invoices = await readInvoices();
    if (!getOwnedInvoice(invoices, id, user.id)) throw new ApiError("Invoice not found", 404);
    const now = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => ({ ...current, status: "Completed", upfront_paid: true, remaining_paid: true, paid_amount: Number(current.amount || 0), completed_at: current.completed_at || now }));
    return withPaymentPlan(updated);
  }

  if (method === "POST" && route === "/stablecoin/fund") {
    const { id, buyerWallet, signature, paymentStage = "full" } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (!buyerWallet || !signature) throw new ApiError("buyerWallet and signature are required for real USDC escrow funding", 400);
    const plan = getPaymentPlan(invoice);
    const stage = ["upfront", "remaining", "full"].includes(paymentStage) ? paymentStage : "full";
    const expectedAmount = stage === "upfront" ? plan.upfront_amount : stage === "remaining" ? plan.remaining_amount : invoice.amount;
    if (stage === "upfront" && invoice.upfront_paid) throw new ApiError("Upfront USDC is already locked for this invoice", 400);
    if (stage === "remaining" && !invoice.upfront_paid) throw new ApiError("Lock upfront USDC before locking the remaining balance", 400);
    const transfer = await verifyStablecoinTransfer({ signature, expectedBuyer: buyerWallet, expectedAmount });
    const fundedAt = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => {
      const currentPlan = getPaymentPlan(current);
      const upfrontPaid = stage === "upfront" || stage === "full" || current.upfront_paid;
      const remainingPaid = stage === "remaining" || stage === "full" || current.remaining_paid;
      const paidAmount = Number(((upfrontPaid ? currentPlan.upfront_amount : 0) + (remainingPaid ? currentPlan.remaining_amount : 0)).toFixed(2));
      return {
        ...current,
        status: remainingPaid || stage === "full" ? "Funded" : "Partially Funded",
        upfront_paid: upfrontPaid,
        remaining_paid: remainingPaid,
        paid_amount: paidAmount,
        funded_at: current.funded_at || fundedAt,
        stablecoin: {
          ...(current.stablecoin || {}),
          chain: transfer.chain,
          token: transfer.token,
          mint: transfer.mint,
          buyerWallet,
          escrowWallet: transfer.escrowWallet,
          escrowTokenAccount: transfer.escrowTokenAccount,
          status: remainingPaid || stage === "full" ? "escrow_locked" : "upfront_locked",
          amount: Number(current.amount),
          upfrontTx: stage === "upfront" ? transfer.signature : current.stablecoin?.upfrontTx || null,
          upfrontExplorerUrl: stage === "upfront" ? transfer.explorerUrl : current.stablecoin?.upfrontExplorerUrl || null,
          remainingTx: stage === "remaining" ? transfer.signature : current.stablecoin?.remainingTx || null,
          remainingExplorerUrl: stage === "remaining" ? transfer.explorerUrl : current.stablecoin?.remainingExplorerUrl || null,
          escrowTx: stage === "full" ? transfer.signature : current.stablecoin?.escrowTx || transfer.signature,
          escrowExplorerUrl: stage === "full" ? transfer.explorerUrl : current.stablecoin?.escrowExplorerUrl || transfer.explorerUrl,
          lockedAmount: paidAmount,
          mode: "real_spl"
        }
      };
    });
    return withPaymentPlan(updated);
  }

  if (method === "POST" && route === "/stablecoin/release") {
    const { id, sellerWallet } = await jsonBody(request);
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, user.id);
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (!sellerWallet) throw new ApiError("sellerWallet is required for real USDC release", 400);
    if (!invoice.upfront_paid || !invoice.remaining_paid) throw new ApiError("Lock both upfront and remaining USDC before releasing escrow", 400);
    const balance = await escrowTokenBalance();
    if (balance.uiAmount < Number(invoice.amount)) throw new ApiError(`Escrow has ${balance.uiAmount} USDC, but this invoice requires ${invoice.amount} USDC before release.`, 400);
    const release = await releaseStablecoinTransfer({ sellerWallet, amount: invoice.amount });
    const completedAt = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => ({ ...current, status: "Completed", upfront_paid: true, remaining_paid: true, paid_amount: Number(current.amount || 0), completed_at: current.completed_at || completedAt, stablecoin: { ...(current.stablecoin || {}), status: "released", sellerWallet, releaseTx: release.signature, releaseExplorerUrl: release.explorerUrl, sourceTokenAccount: release.sourceTokenAccount, destinationTokenAccount: release.destinationTokenAccount, mode: "real_spl" } }));
    return withPaymentPlan(updated);
  }

  throw new ApiError(`Route ${method} ${route} not found`, 404);
}

export function apiErrorResponse(error) {
  console.error("API error:", error);
  return Response.json({ error: error.message || "Unexpected server error" }, { status: error.status || 500 });
}
