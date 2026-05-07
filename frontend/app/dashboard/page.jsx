"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import AuthModal from "../../components/AuthModal";
import InvoiceForm from "../../components/InvoiceForm";
import InvoiceTable from "../../components/InvoiceTable";
import Navbar from "../../components/Navbar";
import {
  createDodoCheckout,
  deleteInvoice,
  fundDodoEscrowFromTreasury,
  fundStablecoinEscrow,
  getStablecoinConfig,
  importInvoices,
  getInvoices,
  releaseStablecoinEscrow,
  syncDodoPayment,
  withdrawFreelancerEscrow
} from "../../lib/api";
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
    const paymentStatus = String(invoice.payment?.status || "").toLowerCase();

    if (invoice.status === "Completed" || ["succeeded", "paid", "completed", "captured"].includes(paymentStatus)) {
      return invoice.seller_payout?.status === "seller_paid" || invoice.payment_method !== "dodo" ? 5 : 3;
    }

    if (invoice.status === "Escrow Funded") return 4;
    if (invoice.status === "Fiat Paid") return 3;
    if (invoice.status === "Funded") return 4;
    if (invoice.status === "Partially Funded") return 3;
    if (paymentStatus === "checkout_created") return 2;
    return 1;
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
    const completedInvoices = invoiceList.filter((invoice) => invoice.status === "Completed");
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

        if (updated.status === "Completed" || ["succeeded", "paid", "completed", "captured"].includes(paymentStatus)) {
          return updated;
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

        if (!cancelled) {
          setNotice(`${refreshedInvoice.id} Dodo payment synced: ${refreshedInvoice.payment?.status || refreshedInvoice.status}.`);
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

  function getSolanaProvider() {
    return window.phantom?.solana || window.solana || window.solflare || window.backpack?.solana || null;
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

  async function waitForSolanaSignature(connection, signature) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = value?.[0];

      if (status?.err) {
        throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
      }

      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return status;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }

    throw new Error(
      `Transaction was sent but not confirmed yet. Signature: ${signature}. Wait a minute, click Refresh, then check Solana Explorer if needed.`
    );
  }

  async function startStablecoinFunding(invoice, paymentStage = "full") {
    if (!requireLogin()) {
      return;
    }

    setBusyId(invoice.id);
    setError("");
    setNotice("");

    try {
      const provider = getSolanaProvider();
      if (!provider) {
        throw new Error("No Solana wallet detected. Install or enable Phantom/Solflare and connect it in this browser.");
      }

      const config = await getStablecoinConfig();
      if (!config.configured) {
        throw new Error("Solana USDC is not configured. Add STABLECOIN_MINT_ADDRESS and STABLECOIN_ESCROW_WALLET to backend/.env.");
      }

      const connection = new Connection(config.rpcUrl, "confirmed");
      const connectResponse = await provider.connect();
      const buyerPublicKey = new PublicKey(connectResponse.publicKey.toString());
      const mint = new PublicKey(config.mint);
      const escrowOwner = new PublicKey(config.escrowWallet);
      const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyerPublicKey);
      const escrowTokenAccount = await getAssociatedTokenAddress(mint, escrowOwner);
      const stageAmount = paymentStage === "upfront"
        ? Number(invoice.upfront_amount)
        : paymentStage === "remaining"
          ? Number(invoice.remaining_amount)
          : Number(invoice.amount);
      const amount = BigInt(Math.round(stageAmount * 10 ** Number(config.decimals)));
      const transaction = new Transaction();
      const buyerTokenAccountInfo = await connection.getParsedAccountInfo(buyerTokenAccount);
      const solBalance = await connection.getBalance(buyerPublicKey);

      if (solBalance <= 0) {
        throw new Error("Your wallet has no devnet SOL for transaction fees. Switch Phantom to Devnet and request an airdrop.");
      }

      if (!buyerTokenAccountInfo.value) {
        throw new Error(`Your wallet does not have a devnet ${config.symbol} token account for mint ${config.mint}. Get devnet USDC first.`);
      }

      const parsedTokenAccount = buyerTokenAccountInfo.value.data?.parsed?.info;
      const tokenAmount = Number(parsedTokenAccount?.tokenAmount?.uiAmountString || 0);

      if (tokenAmount < stageAmount) {
        throw new Error(`Insufficient devnet ${config.symbol}. Need ${stageAmount}, wallet has ${tokenAmount}.`);
      }

      const escrowAccountInfo = await connection.getAccountInfo(escrowTokenAccount);

      if (!escrowAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            buyerPublicKey,
            escrowTokenAccount,
            escrowOwner,
            mint
          )
        );
      }

      transaction.add(
        createTransferCheckedInstruction(
          buyerTokenAccount,
          mint,
          escrowTokenAccount,
          buyerPublicKey,
          amount,
          Number(config.decimals)
        )
      );

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = buyerPublicKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;

      const simulation = await connection.simulateTransaction(transaction);
      if (simulation.value.err) {
        throw new Error(`Solana simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      const { signature } = provider.signAndSendTransaction
        ? await provider.signAndSendTransaction(transaction)
        : { signature: await connection.sendRawTransaction((await provider.signTransaction(transaction)).serialize()) };

      setNotice(`USDC transaction sent. Waiting for devnet confirmation: ${signature.slice(0, 8)}...`);
      await waitForSolanaSignature(connection, signature);
      const updated = await fundStablecoinEscrow(invoice.id, buyerPublicKey.toBase58(), signature, paymentStage);
      setInvoices((current) => {
        const next = current.map((item) => (item.id === invoice.id ? updated : item));
        saveCachedInvoices(next, session);
        return next;
      });
      setNotice(`${stageAmount.toLocaleString()} USDC locked in escrow. Tx: ${signature.slice(0, 8)}...`);
    } catch (err) {
      setError(formatWalletError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function startStablecoinRelease(id) {
    if (!requireLogin()) {
      return;
    }

    setError("");

    try {
      const invoice = invoices.find((item) => item.id === id);
      const sellerWallet = (invoice?.seller_wallet || invoice?.stablecoin?.sellerWallet || "").trim();
      if (!sellerWallet) {
        throw new Error("This invoice does not have a seller wallet saved. Create the invoice with a seller Solana wallet before releasing USDC.");
      }

      new PublicKey(sellerWallet);
      await runAction(id, (invoiceId) => releaseStablecoinEscrow(invoiceId, sellerWallet));
    } catch (err) {
      setError(
        err.message?.includes("Non-base58")
          ? "Enter a valid Solana wallet address, not a MetaMask/EVM address or text from another page."
          : formatWalletError(err)
      );
    }
  }

  async function fundDodoEscrow(id) {
    await runAction(id, fundDodoEscrowFromTreasury);
  }

  async function withdrawDodoEscrow(id) {
    await runAction(id, withdrawFreelancerEscrow);
  }

  return (
    <>
      <Navbar />
      <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSuccess={handleAuthSuccess} />
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
            <p className="mt-3 inline-flex rounded-full border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm font-black text-yellow-800">
              Running on Devnet (Test Mode)
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

        <div className="grid min-w-0 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
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
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {error}
              </div>
            )}
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
                onFundStablecoin={startStablecoinFunding}
                onReleaseStablecoin={startStablecoinRelease}
                onFundDodoEscrow={fundDodoEscrow}
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
