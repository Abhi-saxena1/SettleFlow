import "dotenv/config";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { createResetCode, createSessionToken, hashPassword, publicUser, verifyPassword } from "./auth.js";
import { createDodoCheckoutSession, DodoConfigurationError, retrieveDodoCheckoutSession, unwrapDodoWebhook } from "./dodo.js";
import { analyzeRisk } from "./risk.js";
import { readInvoices, readUsers, updateInvoice, writeInvoices, writeUsers } from "./db.js";
import {
  escrowTokenBalance,
  releaseStablecoinTransfer,
  stablecoinConfig,
  StablecoinConfigurationError,
  verifyStablecoinTransfer
} from "./solana.js";

const app = express();
const PORT = process.env.PORT || 4000;

const mockBuyerHistory = [
  { id: "TX-901", amount: 9200, status: "paid", settledInHours: 4 },
  { id: "TX-902", amount: 17500, status: "paid", settledInHours: 12 },
  { id: "TX-903", amount: 22000, status: "late", settledInHours: 96 }
];

const configuredStablecoin = stablecoinConfig();

function getOwnedInvoice(invoices, id, userId) {
  return invoices.find((invoice) => invoice.id === id && invoice.ownerUserId === userId);
}

function normalizeUpfrontPercentage(value) {
  const percentage = Number(value || 50);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
    return 50;
  }

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
  const progress = amount > 0 ? Math.min(100, Math.round((paidAmount / amount) * 100)) : 0;

  return {
    upfront_percentage: upfrontPercentage,
    upfront_amount: upfrontAmount,
    remaining_amount: remainingAmount,
    paid_amount: paidAmount,
    payment_progress: progress,
    upfront_paid: upfrontPaid,
    remaining_paid: remainingPaid
  };
}

function withPaymentPlan(invoice) {
  const normalizedAmount = Number(invoice.amount || 0);
  const normalizedStatus = invoice.status || "Pending";

  return {
    ...invoice,
    amount: normalizedAmount,
    currency: invoice.currency || "USDC",
    status: normalizedStatus,
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
      chain: configuredStablecoin.chain,
      token: configuredStablecoin.symbol,
      mint: configuredStablecoin.mint,
      status: "not_started",
      amount: normalizedAmount,
      escrowTx: null,
      releaseTx: null,
      mode: "real_spl"
    },
    ...getPaymentPlan(invoice)
  };
}

function buildAnalytics(invoices) {
  const completedInvoices = invoices.filter((invoice) => invoice.status === "Completed");
  const totalSettled = completedInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const settlementDurations = completedInvoices
    .map((invoice) => {
      const fundedAt = invoice.funded_at ? new Date(invoice.funded_at).getTime() : NaN;
      const completedAt = invoice.completed_at ? new Date(invoice.completed_at).getTime() : NaN;
      return Number.isFinite(fundedAt) && Number.isFinite(completedAt) ? completedAt - fundedAt : null;
    })
    .filter((duration) => duration !== null && duration >= 0);
  const avgSettlementTimeHours = settlementDurations.length
    ? settlementDurations.reduce((sum, duration) => sum + duration, 0) / settlementDurations.length / 36e5
    : 0;
  const roundedAverageHours = avgSettlementTimeHours > 0 && avgSettlementTimeHours < 0.01
    ? 0.01
    : Number(avgSettlementTimeHours.toFixed(2));

  return {
    totalSettled: Number(totalSettled.toFixed(2)),
    avgSettlementTimeHours: roundedAverageHours,
    totalInvoices: invoices.length
  };
}

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000"
  })
);

app.get("/dodo/webhook", (_req, res) => {
  res.json({
    ok: true,
    route: "/dodo/webhook",
    method: "POST",
    publicWebhookUrl:
      process.env.DODO_PAYMENTS_WEBHOOK_URL ||
      "Set DODO_PAYMENTS_WEBHOOK_URL to your ngrok / public tunnel URL.",
    localhostNote:
      "Do not use localhost in the Dodo dashboard. Dodo must call the publicWebhookUrl because localhost only exists on your machine.",
    signatureVerification: Boolean(process.env.DODO_PAYMENTS_WEBHOOK_KEY),
    message: "Dodo webhook endpoint is ready. Configure the publicWebhookUrl in Dodo as a POST webhook endpoint."
  });
});

app.post("/dodo/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const payload = unwrapDodoWebhook(req.body.toString("utf-8"), req.headers);
    const eventType = payload.type || payload.event_type || payload.event;
    const data = payload.data || payload;
    const metadata = data.metadata || data.payment?.metadata || {};
    const invoiceId = metadata.invoice_id || data.invoice_id;
    const paymentStatus = data.payment_status || data.status || data.payment?.status;
    const paymentId = data.payment_id || data.id || data.payment?.id;

    if (invoiceId) {
      await updateInvoice(invoiceId, (invoice) => ({
        ...invoice,
        payment: {
          ...(invoice.payment || {}),
          provider: "dodo",
          status: paymentStatus || "webhook_received",
          paymentId: paymentId || invoice.payment?.paymentId || null,
          lastEvent: eventType || "unknown",
          updatedAt: new Date().toISOString()
        }
      }));
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Dodo webhook error:", error);
    res.status(401).json({ error: "Invalid Dodo webhook" });
  }
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "settleflow-backend" });
});

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Login required before making transactions." });
  }

  const users = await readUsers();
  const user = users.find((item) => item.sessionTokens?.includes(token));

  if (!user) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }

  req.user = publicUser(user);
  next();
}

app.post("/auth/signup", async (req, res) => {
  try {
    const { name, email, password, company = "" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }

    const users = await readUsers();
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = users.find((user) => user.email === normalizedEmail);

    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const user = {
      id: `USR-${nanoid(8).toUpperCase()}`,
      name,
      email: normalizedEmail,
      company,
      passwordHash: hashPassword(password),
      sessionTokens: [],
      createdAt: new Date().toISOString()
    };
    const token = createSessionToken();
    user.sessionTokens.push(token);

    users.unshift(user);
    await writeUsers(users);

    res.status(201).json({
      user: publicUser(user),
      token
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to create account" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const users = await readUsers();
    const normalizedEmail = email.toLowerCase().trim();
    const user = users.find((item) => item.email === normalizedEmail);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = createSessionToken();
    user.sessionTokens = [...(user.sessionTokens || []), token].slice(-5);
    await writeUsers(users);

    res.json({
      user: publicUser(user),
      token
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to log in" });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const users = await readUsers();
    const normalizedEmail = email?.toLowerCase().trim();
    const user = users.find((item) => item.email === normalizedEmail);

    if (!user) {
      return res.json({ message: "If an account exists, a reset code was generated." });
    }

    user.resetCode = createResetCode();
    user.resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await writeUsers(users);

    res.json({
      message: "Password reset code generated. In production this would be emailed.",
      resetCode: user.resetCode
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to create reset code" });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const { email, resetCode, password } = req.body;

    if (!email || !resetCode || !password) {
      return res.status(400).json({ error: "email, reset code, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }

    const users = await readUsers();
    const normalizedEmail = email.toLowerCase().trim();
    const user = users.find((item) => item.email === normalizedEmail);

    if (!user || user.resetCode !== resetCode || new Date(user.resetCodeExpiresAt) < new Date()) {
      return res.status(400).json({ error: "Invalid or expired reset code" });
    }

    user.passwordHash = hashPassword(password);
    user.sessionTokens = [];
    delete user.resetCode;
    delete user.resetCodeExpiresAt;
    await writeUsers(users);

    res.json({ message: "Password reset. Please log in again." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to reset password" });
  }
});

app.post("/invoice/create", requireAuth, async (req, res) => {
  try {
    const { amount, buyer, seller, upfront_percentage } = req.body;

    if (!amount || !buyer || !seller) {
      return res.status(400).json({ error: "amount, buyer, and seller are required" });
    }

    const upfrontPercentage = normalizeUpfrontPercentage(upfront_percentage);
    const risk = await analyzeRisk({ amount, buyerHistory: mockBuyerHistory });
    const invoices = await readInvoices();
    const invoice = {
      id: `INV-${nanoid(6).toUpperCase()}`,
      source: "user",
      ownerUserId: req.user.id,
      amount: Number(amount),
      currency: "USDC",
      buyer,
      seller,
      status: "Pending",
      upfront_percentage: upfrontPercentage,
      upfront_paid: false,
      remaining_paid: false,
      paid_amount: 0,
      funded_at: null,
      completed_at: null,
      risk,
      escrow: {
        locked: false,
        released: false,
        mockTx: null
      },
      payment: {
        provider: "dodo",
        status: "not_started",
        sessionId: null,
        checkoutUrl: null,
        paymentId: null,
        mode: "unconfigured"
      },
      stablecoin: {
        chain: configuredStablecoin.chain,
        token: configuredStablecoin.symbol,
        mint: configuredStablecoin.mint,
        status: "not_started",
        amount: Number(amount),
        escrowTx: null,
        releaseTx: null,
        mode: "real_spl"
      },
      createdAt: new Date().toISOString()
    };

    invoices.unshift(invoice);
    await writeInvoices(invoices);

    res.status(201).json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to create invoice" });
  }
});

app.get("/invoice/all", requireAuth, async (req, res) => {
  try {
    const invoices = await readInvoices();
    res.json(
      invoices
        .filter((invoice) => invoice.ownerUserId === req.user.id && invoice.id)
        .map(withPaymentPlan)
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to load invoices" });
  }
});

app.delete("/invoice/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const remainingInvoices = invoices.filter((item) => item.id !== id);
    await writeInvoices(remainingInvoices);

    res.json({ deleted: true, id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to delete invoice" });
  }
});

app.get("/analytics/summary", requireAuth, async (req, res) => {
  try {
    const invoices = await readInvoices();
    const ownedInvoices = invoices.filter((invoice) => invoice.ownerUserId === req.user.id);
    res.json(buildAnalytics(ownedInvoices));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to calculate analytics" });
  }
});

app.post("/invoice/fund", requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const invoices = await readInvoices();
    if (!getOwnedInvoice(invoices, id, req.user.id)) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const fundedAt = new Date().toISOString();
    const invoice = await updateInvoice(id, (current) => {
      if (current.status === "Completed") {
        return current;
      }

      return {
        ...current,
        status: "Funded",
        upfront_paid: true,
        remaining_paid: false,
        paid_amount: Number(current.amount || 0),
        funded_at: current.funded_at || fundedAt,
        escrow: {
          locked: true,
          released: false,
          mockTx: `mock_fund_${current.id}`
        }
      };
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to fund invoice" });
  }
});

app.post("/invoice/pay-upfront", requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const invoices = await readInvoices();
    const currentInvoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!currentInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (currentInvoice.status === "Completed") {
      return res.status(400).json({ error: "Invoice is already completed" });
    }

    const fundedAt = new Date().toISOString();
    const invoice = await updateInvoice(id, (current) => {
      const plan = getPaymentPlan(current);

      return {
        ...current,
        currency: current.currency || "USDC",
        status: "Partially Funded",
        upfront_percentage: plan.upfront_percentage,
        upfront_paid: true,
        remaining_paid: false,
        paid_amount: plan.upfront_amount,
        funded_at: current.funded_at || fundedAt,
        escrow: {
          ...(current.escrow || {}),
          locked: true,
          released: false,
          mockTx: `partial_upfront_${current.id}`
        }
      };
    });

    res.json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to pay upfront amount" });
  }
});

app.post("/invoice/pay-remaining", requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const invoices = await readInvoices();
    const currentInvoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!currentInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!currentInvoice.upfront_paid && currentInvoice.status !== "Funded") {
      return res.status(400).json({ error: "Pay the upfront amount before paying the remaining balance" });
    }

    const completedAt = new Date().toISOString();
    const invoice = await updateInvoice(id, (current) => {
      const plan = getPaymentPlan({ ...current, upfront_paid: true, remaining_paid: true });

      return {
        ...current,
        currency: current.currency || "USDC",
        status: "Completed",
        upfront_percentage: plan.upfront_percentage,
        upfront_paid: true,
        remaining_paid: true,
        paid_amount: Number(current.amount || 0),
        funded_at: current.funded_at || completedAt,
        completed_at: current.completed_at || completedAt,
        escrow: {
          ...(current.escrow || {}),
          locked: false,
          released: true,
          mockTx: `partial_remaining_${current.id}`
        }
      };
    });

    res.json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to pay remaining amount" });
  }
});

app.post("/invoice/checkout", requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const checkout = await createDodoCheckoutSession(invoice);
    const updated = await updateInvoice(id, (current) => ({
      ...current,
      payment: {
        ...(current.payment || {}),
        provider: "dodo",
        status: checkout.status,
        sessionId: checkout.sessionId,
        checkoutUrl: checkout.checkoutUrl,
        mode: checkout.mode,
        intendedAmount: checkout.intendedAmount,
        intendedAmountMinor: checkout.intendedAmountMinor,
        previewAmountMinor: checkout.previewAmountMinor,
        currency: checkout.currency,
        message: checkout.message || null,
        createdAt: new Date().toISOString()
      }
    }));

    res.json({ invoice: withPaymentPlan(updated), checkout });
  } catch (error) {
    console.error(error);
    if (error instanceof DodoConfigurationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || "Unable to create Dodo checkout session" });
  }
});

app.post("/invoice/payment/sync", requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const invoices = await readInvoices();
    const invoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!invoice.payment?.sessionId) {
      return res.status(400).json({ error: "Invoice does not have a Dodo checkout session yet" });
    }

    const session = await retrieveDodoCheckoutSession(invoice.payment.sessionId);
    const paymentStatus = session.payment_status || session.status || "processing";
    const now = new Date().toISOString();
    const updated = await updateInvoice(id, (current) => ({
      ...current,
      status: paymentStatus === "succeeded" && current.status === "Pending" ? "Funded" : current.status,
      upfront_paid: paymentStatus === "succeeded" ? true : current.upfront_paid || false,
      remaining_paid: paymentStatus === "succeeded" ? true : current.remaining_paid || false,
      paid_amount: paymentStatus === "succeeded" ? Number(current.amount || 0) : current.paid_amount || 0,
      funded_at: paymentStatus === "succeeded" ? current.funded_at || now : current.funded_at || null,
      escrow: {
        ...(current.escrow || {}),
        locked: paymentStatus === "succeeded" ? true : current.escrow?.locked || false,
        mockTx: paymentStatus === "succeeded" ? `dodo_fund_${current.id}` : current.escrow?.mockTx || null
      },
      payment: {
        ...(current.payment || {}),
        provider: "dodo",
        status: paymentStatus,
        paymentId: session.payment_id || session.payment?.id || current.payment?.paymentId || null,
        updatedAt: new Date().toISOString()
      }
    }));

    res.json({ invoice: withPaymentPlan(updated), session });
  } catch (error) {
    console.error(error);
    if (error instanceof DodoConfigurationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || "Unable to sync Dodo payment status" });
  }
});

app.post("/stablecoin/fund", requireAuth, async (req, res) => {
  try {
    const { id, buyerWallet, signature, paymentStage = "full" } = req.body;
    const invoices = await readInvoices();
    const currentInvoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!currentInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!buyerWallet || !signature) {
      return res.status(400).json({ error: "buyerWallet and signature are required for real USDC escrow funding" });
    }

    const plan = getPaymentPlan(currentInvoice);
    const stage = ["upfront", "remaining", "full"].includes(paymentStage) ? paymentStage : "full";
    const expectedAmount = stage === "upfront"
      ? plan.upfront_amount
      : stage === "remaining"
        ? plan.remaining_amount
        : currentInvoice.amount;

    if (stage === "upfront" && currentInvoice.upfront_paid) {
      return res.status(400).json({ error: "Upfront USDC is already locked for this invoice" });
    }

    if (stage === "remaining" && !currentInvoice.upfront_paid) {
      return res.status(400).json({ error: "Lock upfront USDC before locking the remaining balance" });
    }

    if (stage === "remaining" && currentInvoice.remaining_paid) {
      return res.status(400).json({ error: "Remaining USDC is already locked for this invoice" });
    }

    const transfer = await verifyStablecoinTransfer({
      signature,
      expectedBuyer: buyerWallet,
      expectedAmount
    });

    const fundedAt = new Date().toISOString();
    const invoice = await updateInvoice(id, (current) => {
      if (current.status === "Completed") {
        return current;
      }

      const currentPlan = getPaymentPlan(current);
      const upfrontPaid = stage === "upfront" || stage === "full" || current.upfront_paid;
      const remainingPaid = stage === "remaining" || stage === "full" || current.remaining_paid;
      const paidAmount = Number(
        ((upfrontPaid ? currentPlan.upfront_amount : 0) + (remainingPaid ? currentPlan.remaining_amount : 0)).toFixed(2)
      );
      const nextStatus = remainingPaid || stage === "full" ? "Funded" : "Partially Funded";

      return {
        ...current,
        status: nextStatus,
        upfront_paid: upfrontPaid,
        remaining_paid: remainingPaid,
        paid_amount: paidAmount,
        funded_at: current.funded_at || fundedAt,
        escrow: {
          ...(current.escrow || {}),
          locked: true,
          released: false,
          mockTx: `usdc_escrow_${current.id}`
        },
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
          slot: transfer.slot,
          lockedAmount: paidAmount,
          releaseTx: current.stablecoin?.releaseTx || null,
          mode: "real_spl"
        }
      };
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    if (error instanceof StablecoinConfigurationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: "Unable to fund USDC escrow" });
  }
});

app.post("/stablecoin/release", requireAuth, async (req, res) => {
  try {
    const { id, sellerWallet } = req.body;
    const invoices = await readInvoices();
    const currentInvoice = getOwnedInvoice(invoices, id, req.user.id);

    if (!currentInvoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (!sellerWallet) {
      return res.status(400).json({ error: "sellerWallet is required for real USDC release" });
    }

    if (!currentInvoice.upfront_paid || !currentInvoice.remaining_paid) {
      return res.status(400).json({ error: "Lock both upfront and remaining USDC before releasing escrow" });
    }

    const escrowBalance = await escrowTokenBalance();

    if (escrowBalance.uiAmount < Number(currentInvoice.amount)) {
      return res.status(400).json({
        error: `Escrow has ${escrowBalance.uiAmount} USDC, but this invoice requires ${currentInvoice.amount} USDC before release.`
      });
    }

    const release = await releaseStablecoinTransfer({
      sellerWallet,
      amount: currentInvoice.amount
    });

    const completedAt = new Date().toISOString();
    const invoice = await updateInvoice(id, (current) => {
      if (current.status !== "Funded") {
        return current;
      }

      return {
        ...current,
        status: "Completed",
        upfront_paid: true,
        remaining_paid: true,
        paid_amount: Number(current.amount || 0),
        completed_at: current.completed_at || completedAt,
        escrow: {
          ...(current.escrow || {}),
          locked: false,
          released: true,
          mockTx: `usdc_release_${current.id}`
        },
        stablecoin: {
          ...(current.stablecoin || {}),
          status: "released",
          sellerWallet,
          releaseTx: release.signature,
          releaseExplorerUrl: release.explorerUrl,
          sourceTokenAccount: release.sourceTokenAccount,
          destinationTokenAccount: release.destinationTokenAccount,
          mode: "real_spl",
          note: "USDC released from backend escrow signer."
        }
      };
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    if (error instanceof StablecoinConfigurationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    const message = error.message?.includes("Non-base58")
      ? "Invalid seller Solana wallet address. Use a Solana address from Phantom/Solflare, not a MetaMask/EVM address."
      : error.message || "Unable to release USDC escrow";
    res.status(500).json({ error: message });
  }
});

app.get("/stablecoin/config", (_req, res) => {
  const config = stablecoinConfig();

  res.json({
    configured: Boolean(config.mint && config.escrowWallet),
    chain: config.chain,
    symbol: config.symbol,
    mint: config.mint,
    escrowWallet: config.escrowWallet,
    decimals: config.decimals,
    rpcUrl: config.rpcUrl
  });
});

app.post("/invoice/release", requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const invoices = await readInvoices();
    if (!getOwnedInvoice(invoices, id, req.user.id)) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const completedAt = new Date().toISOString();
    const invoice = await updateInvoice(id, (current) => {
      if (current.status !== "Funded" && current.status !== "Partially Funded") {
        return current;
      }

      return {
        ...current,
        status: "Completed",
        upfront_paid: true,
        remaining_paid: true,
        paid_amount: Number(current.amount || 0),
        funded_at: current.funded_at || completedAt,
        completed_at: current.completed_at || completedAt,
        escrow: {
          ...current.escrow,
          locked: false,
          released: true,
          mockTx: `mock_release_${current.id}`
        }
      };
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json(withPaymentPlan(invoice));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to release invoice" });
  }
});

app.post("/ai/risk", async (req, res) => {
  try {
    const { amount, buyerHistory = mockBuyerHistory } = req.body;
    const numericAmount = Number(amount);

    res.set("Cache-Control", "no-store");

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "valid amount is required" });
    }

    const risk = await analyzeRisk({ amount: numericAmount, buyerHistory });
    res.json({
      ...risk,
      analyzed_amount: numericAmount,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to analyze risk" });
  }
});

app.listen(PORT, () => {
  console.log(`SettleFlow API running on http://localhost:${PORT}`);
});
