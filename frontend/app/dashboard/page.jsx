"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";
import AuthModal from "../../components/AuthModal";
import InvoiceForm from "../../components/InvoiceForm";
import InvoiceTable from "../../components/InvoiceTable";
import Navbar from "../../components/Navbar";
import {
  createDodoCheckout,
  deleteInvoice,
  confirmSellerWithdraw,
  getStablecoinConfig,
  importInvoices,
  getInvoices,
  prepareSellerWithdraw,
  releaseAnchorEscrow,
  syncDodoPayment
} from "../../lib/api";
import { PAYMENT_STATES, normalizePaymentState, paymentStateRank } from "../../lib/paymentStates";
import {
  AUTH_CHANGED_EVENT,
  getCachedInvoices,
  getStoredSession,
  saveCachedInvoices,
  saveSession
} from "../../lib/authSession";

export default function DashboardPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authMode, setAuthMode] = useState(null);

  const isAuthenticated = Boolean(session?.token);

  function transactionFromBase64(value) {
    const binary = window.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return Transaction.from(bytes);
  }

  function getSolanaProvider() {
    return window.phantom?.solana || window.solana || window.solflare || window.backpack?.solana || null;
  }

  async function waitForDevnetConfirmation(signature) {
    const config = await getStablecoinConfig();
    const connection = new Connection(config.rpcUrl || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    await connection.confirmTransaction(signature, "confirmed");
  }

  function invoiceTimestamp(invoice) {
    return Math.max(
      new Date(invoice.payment?.updatedAt || 0).getTime(),
      new Date(invoice.completed_at || 0).getTime(),
      new Date(invoice.funded_at || 0).getTime(),
      new Date(invoice.createdAt || 0).getTime(),
      0
    );
  }

  function invoiceStateRank(invoice) {
    return paymentStateRank(invoice.status);
  }

  function mergeInvoiceLists(...lists) {
    const byId = new Map();

    for (const invoice of lists.flat()) {
      if (!invoice?.id) continue;
      const existing = byId.get(invoice.id);

      if (!existing) {
        byId.set(invoice.id, invoice);
        continue;
      }

      const invoiceRank = invoiceStateRank(invoice);
      const existingRank = invoiceStateRank(existing);
      const invoiceIsBetter = invoiceRank > existingRank ||
        (invoiceRank === existingRank && invoiceTimestamp(invoice) >= invoiceTimestamp(existing));
      const newer = invoiceIsBetter ? invoice : existing;
      const older = invoiceIsBetter ? existing : invoice;

      byId.set(invoice.id, {
        ...older,
        ...newer,
        payment: {
          ...(older.payment || {}),
          ...(newer.payment || {})
        },
        stablecoin: {
          ...(older.stablecoin || {}),
          ...(newer.stablecoin || {})
        },
        risk: newer.risk || older.risk
      });
    }

    return Array.from(byId.values()).sort((a, b) => invoiceTimestamp(b) - invoiceTimestamp(a));
  }

  function buildDashboardAnalytics(invoiceList) {
    const completedInvoices = invoiceList.filter((invoice) => normalizePaymentState(invoice.status) === PAYMENT_STATES.WITHDRAWN);
    const totalSettled = completedInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const durations = completedInvoices
      .map((invoice) => {
        const fundedAt = invoice.funded_at ? new Date(invoice.funded_at).getTime() : NaN;
        const completedAt = invoice.completed_at ? new Date(invoice.completed_at).getTime() : NaN;
        return Number.isFinite(fundedAt) && Number.isFinite(completedAt) ? completedAt - fundedAt : null;
      })
      .filter((duration) => duration !== null && duration >= 0);
    const averageHours = durations.length
      ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 36e5
      : 0;

    return {
      totalSettled: Number(totalSettled.toFixed(2)),
      avgSettlementTimeHours: averageHours > 0 && averageHours < 0.01 ? 0.01 : Number(averageHours.toFixed(2)),
      totalInvoices: invoiceList.length
    };
  }

  function applyInvoiceList(nextInvoices) {
    setInvoices(nextInvoices);
    saveCachedInvoices(nextInvoices, session);
  }

  const analytics = useMemo(() => buildDashboardAnalytics(invoices), [invoices]);

  async function refreshInvoicesAfterPayment() {
    const cachedInvoices = getCachedInvoices(session);
    let serverInvoices = [];
    let serverReadFailed = false;

    try {
      serverInvoices = await getInvoices();
    } catch {
      serverReadFailed = true;
    }

    let data = mergeInvoiceLists(cachedInvoices, serverInvoices);

    if (data.length > 0) {
      const restoredInvoices = await importInvoices(data).catch(() => []);
      data = mergeInvoiceLists(data, restoredInvoices);
    }

    if (data.length === 0 && invoices.length > 0 && serverReadFailed) {
      return invoices;
    }

    if (data.length === 0 && invoices.length > 0 && loading) {
      return invoices;
    }

    applyInvoiceList(data);
    return data;
  }

  async function syncDodoPaymentWithRetry(invoiceId, attempts = 8) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const updated = await syncDodoPayment(invoiceId);
        setInvoices((current) => {
          const next = mergeInvoiceLists(current, [updated]);
          saveCachedInvoices(next, session);
          return next;
        });
        const paymentStatus = String(updated.payment?.status || "").toLowerCase();
        const fundingError = updated.fiat_escrow?.fundingError || updated.stablecoin?.fundingError;

        if ([
          PAYMENT_STATES.ESCROW_FUNDED,
          PAYMENT_STATES.WORK_SUBMITTED,
          PAYMENT_STATES.RELEASED,
          PAYMENT_STATES.WITHDRAWN
        ].includes(normalizePaymentState(updated.status))) {
          return updated;
        }

        if (fundingError) {
          return updated;
        }

        if (["succeeded", "paid", "completed", "captured"].includes(paymentStatus) && normalizePaymentState(updated.status) === PAYMENT_STATES.TREASURY_FUNDING_PENDING) {
          lastError = new Error("Dodo payment confirmed. Treasury escrow funding is still confirming on Devnet.");
        }

        if (attempt === attempts - 1) {
          return updated;
        }
      } catch (err) {
        lastError = err;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1400 + attempt * 900));
    }

    throw lastError || new Error("Dodo payment sync did not complete yet.");
  }

  async function loadInvoices() {
    setError("");
    setLoading(true);
    try {
      await refreshInvoicesAfterPayment();
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("login")) {
        setInvoices([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const storedSession = getStoredSession();
    setSession(storedSession);
    if (storedSession?.token) {
      const cachedInvoices = getCachedInvoices(storedSession);
      if (cachedInvoices.length > 0) {
        setInvoices(cachedInvoices);
      }
    }
    setSessionReady(true);

    function handleAuthChanged(event) {
      setSession(event.detail || getStoredSession());
      setSessionReady(true);
    }

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener("storage", handleAuthChanged);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener("storage", handleAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) {
      return;
    }

    if (session?.token) {
      loadInvoices();
      return;
    }

    setInvoices([]);
    setLoading(false);
  }, [sessionReady, session?.token]);

  useEffect(() => {
    if (!sessionReady || !session?.token) {
      return;
    }

    const invoiceId = new URLSearchParams(window.location.search).get("invoice_id");
    if (!invoiceId) {
      return;
    }

    let cancelled = false;

    async function syncReturnedDodoPayment() {
      setBusyId(invoiceId);
      setError("");

      try {
        const updated = await syncDodoPaymentWithRetry(invoiceId);
        if (cancelled) return;

        const refreshed = await refreshInvoicesAfterPayment();
        const refreshedInvoice = refreshed.find((invoice) => invoice.id === invoiceId) || updated;
        const fundingError = refreshedInvoice.fiat_escrow?.fundingError || refreshedInvoice.stablecoin?.fundingError;

        if (!cancelled) {
          if (fundingError) {
            setError(fundingError);
          } else {
            setNotice(`${refreshedInvoice.id} Dodo payment synced: ${refreshedInvoice.payment?.status || refreshedInvoice.status}.`);
          }
        }

        window.history.replaceState({}, "", window.location.pathname + window.location.hash);
      } catch (err) {
        if (!cancelled) {
          await refreshInvoicesAfterPayment().catch(() => null);
          setNotice("Dodo payment sync is still pending. The dashboard list was refreshed.");
        }
      } finally {
        if (!cancelled) {
          setBusyId(null);
        }
      }
    }

    syncReturnedDodoPayment();

    return () => {
      cancelled = true;
    };
  }, [sessionReady, session?.token]);

  function promptLogin() {
    setError("Please log in before creating invoices or moving funds.");
    setAuthMode("login");
  }

  function requireLogin() {
    if (isAuthenticated) {
      return true;
    }

    promptLogin();
    return false;
  }

  function handleAuthSuccess(result) {
    setSession(saveSession(result));
    setAuthMode(null);
    setError("");
  }

  async function runAction(id, action) {
    if (!requireLogin()) {
      return;
    }

    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const updated = await action(id);
      setInvoices((current) => {
        const next = current.map((invoice) => (invoice.id === id ? updated : invoice));
        saveCachedInvoices(next, session);
        return next;
      });
      setNotice(`${updated.id} updated to ${updated.status}.`);
    } catch (err) {
      if (err.message.toLowerCase().includes("invoice not found")) {
        await refreshInvoicesAfterPayment().catch(() => null);
        setError("");
        setNotice("The server invoice cache was refreshed. Try the action again if needed.");
        return;
      }

      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeInvoice(id) {
    if (!requireLogin()) {
      return;
    }

    const confirmed = window.confirm("Delete this invoice from your dashboard?");
    if (!confirmed) {
      return;
    }

    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await deleteInvoice(id);
      setInvoices((current) => {
        const next = current.filter((invoice) => invoice.id !== id);
        saveCachedInvoices(next, session);
        return next;
      });
      setNotice("Invoice deleted.");
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("invoice not found")) {
        setInvoices((current) => current.filter((invoice) => invoice.id !== id));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function startDodoCheckout(id) {
    if (!requireLogin()) {
      return;
    }

    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const result = await createDodoCheckout(id);
      const next = mergeInvoiceLists(invoices, [result.invoice]);
      applyInvoiceList(next);
      setNotice(`Dodo checkout created for ${Number(result.checkout?.intendedAmount || 0).toLocaleString()} USDC.`);

      if (result.checkout?.checkoutUrl) {
        window.location.assign(result.checkout.checkoutUrl);
      }
    } catch (err) {
      if (err.message.toLowerCase().includes("invoice not found")) {
        await importInvoices(invoices).catch(() => null);
        setError("");
        setNotice("The invoice list was restored. Click Pay with Dodo again.");
        return;
      }

      const needsDynamicPricing = err.message.toLowerCase().includes("pay what you want");
      setError(needsDynamicPricing
        ? err.message
        : `${err.message} Create backend/.env from backend/.env.example, add your Dodo API key and product ID, then restart the backend.`
      );
    } finally {
      setBusyId(null);
    }
  }

  function formatWalletError(error) {
    if (error?.message) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "USDC transfer failed. Check that your wallet is on Solana Devnet and has devnet SOL plus devnet USDC.";
  }

  async function startStablecoinRelease(id) {
    await runAction(id, releaseAnchorEscrow);
  }

  async function withdrawDodoEscrow(id) {
    await runAction(id, async (invoiceId) => {
      const invoice = invoices.find((item) => item.id === invoiceId);
      if (!invoice) throw new Error("Invoice not found in dashboard cache. Refresh and try again.");
      const provider = getSolanaProvider();
      if (!provider) throw new Error("No Solana wallet detected. Open this with Phantom or another Solana wallet installed.");
      const connected = await provider.connect();
      const sellerWallet = connected.publicKey?.toBase58?.() || provider.publicKey?.toBase58?.();
      if (!sellerWallet) throw new Error("Unable to read connected seller wallet.");
      if (sellerWallet !== invoice.seller_wallet) throw new Error("Connected wallet does not match this invoice seller wallet.");

      const prepared = await prepareSellerWithdraw(invoiceId, sellerWallet);
      const transaction = transactionFromBase64(prepared.transaction);
      let signature = "";

      if (provider.signAndSendTransaction) {
        const result = await provider.signAndSendTransaction(transaction);
        signature = typeof result === "string" ? result : result.signature;
      } else {
        const signed = await provider.signTransaction(transaction);
        const config = await getStablecoinConfig();
        const connection = new Connection(config.rpcUrl || process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
        signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      }

      await waitForDevnetConfirmation(signature);
      return confirmSellerWithdraw(invoiceId, signature, sellerWallet);
    });
  }

  return (
    <>
      <Navbar />
      <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSuccess={handleAuthSuccess} />
      {error && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center px-5">
          <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-center text-sm font-bold text-red-700 shadow-glow">
            {error}
          </div>
        </div>
      )}
      <main className="container-shell py-10">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-black/55 hover:text-ink">
          <ArrowLeft size={16} />
          Back to home
        </Link>
        <div className="mb-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="section-kicker">Operations</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-ink sm:text-5xl">Settlement dashboard</h1>
            <p className="mt-4 max-w-2xl leading-7 text-black/60">
              Create invoices, collect funds through real Dodo Payments checkout sessions, release escrow, and review AI risk signals.
            </p>
          </div>
          <button onClick={isAuthenticated ? loadInvoices : promptLogin} className="button-secondary gap-2">
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <p className="section-kicker">Total Settled</p>
            <p className="mt-2 text-3xl font-black text-ink">
              {Number(analytics.totalSettled || 0).toLocaleString()} USDC
            </p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <p className="section-kicker">Avg Settlement Time</p>
            <p className="mt-2 text-3xl font-black text-ink">
              {Number(analytics.avgSettlementTimeHours || 0).toLocaleString()} hours
            </p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <p className="section-kicker">Total Invoices</p>
            <p className="mt-2 text-3xl font-black text-ink">
              {Number(analytics.totalInvoices || 0).toLocaleString()}
            </p>
          </div>
        </section>

        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <InvoiceForm
            disabled={!isAuthenticated}
            onLoginRequired={promptLogin}
            onError={setError}
            onCreated={(invoice) => {
              setInvoices((current) => {
                const next = [invoice, ...current];
                saveCachedInvoices(next, session);
                return next;
              });
            }}
          />
          <section className="min-w-0">
            {notice && (
              <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
                {notice}
              </div>
            )}
            {!isAuthenticated ? (
              <div className="grid min-h-80 place-items-center rounded-xl border border-black/10 bg-white p-8 text-center shadow-md">
                <div>
                  <p className="section-kicker">Login required</p>
                  <h2 className="mt-2 text-2xl font-black text-ink">Your dashboard is private</h2>
                  <p className="mt-3 max-w-md text-black/55">
                    Log in or sign up to create invoices, fund escrow, release payments, and see only your own transactions.
                  </p>
                  <button onClick={() => setAuthMode("login")} className="button-primary mt-6">
                    Login
                  </button>
                </div>
              </div>
            ) : loading ? (
              <div className="grid min-h-80 place-items-center rounded-xl border border-black/10 bg-white shadow-md">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-leaf border-t-transparent" />
              </div>
            ) : (
              <InvoiceTable
                invoices={invoices}
                onDelete={removeInvoice}
                onDodoCheckout={startDodoCheckout}
                onSyncPayment={(id) => runAction(id, syncDodoPayment)}
                onReleaseStablecoin={startStablecoinRelease}
                onWithdrawFreelancer={withdrawDodoEscrow}
                busyId={busyId}
              />
            )}
          </section>
        </div>
      </main>
    </>
  );
}
