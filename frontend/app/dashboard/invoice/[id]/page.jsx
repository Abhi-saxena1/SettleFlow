"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Copy, ExternalLink, Loader2, Printer, RefreshCw, Share2, Trash2 } from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";
import AuthModal from "../../../../components/AuthModal";
import Navbar from "../../../../components/Navbar";
import { confirmSellerWithdraw, createDodoCheckout, createInvoiceShareLink, deleteInvoice, fundDodoEscrowFromTreasury, getInvoice, getStablecoinConfig, prepareSellerWithdraw, releaseAnchorEscrow, syncDodoPayment } from "../../../../lib/api";
import { AUTH_CHANGED_EVENT, getStoredSession, saveSession } from "../../../../lib/authSession";
import { PAYMENT_STATES, normalizePaymentState, paymentStateLabel } from "../../../../lib/paymentStates";

const statusStyles = {
  draft: "bg-yellow-100 text-yellow-800",
  checkout_pending: "bg-purple-100 text-purple-800",
  fiat_paid: "bg-purple-100 text-purple-800",
  treasury_funding_pending: "bg-orange-100 text-orange-800",
  escrow_funded: "bg-blue-100 text-blue-800",
  work_submitted: "bg-blue-100 text-blue-800",
  release_pending: "bg-blue-100 text-blue-800",
  released: "bg-emerald-100 text-emerald-800",
  withdrawn: "bg-green-100 text-green-800",
  refunded: "bg-gray-100 text-gray-700",
  disputed: "bg-red-100 text-red-800"
};

const riskStyles = {
  Low: "bg-green-100 text-green-800",
  Medium: "bg-orange-100 text-orange-800",
  High: "bg-red-100 text-red-800"
};

function formatAmount(value, currency = "USDC") {
  return `${Number(value || 0).toLocaleString()} ${currency}`;
}

function formatDate(value) {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatStatus(value) {
  return paymentStateLabel(value);
}

function shortHash(value) {
  return value ? `${value.slice(0, 7)}...${value.slice(-5)}` : "";
}

function explorerUrl(signature) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : "";
}

function Pill({ children, className }) {
  return (
    <span className={`inline-flex min-h-9 items-center rounded-full px-4 py-2 text-xs font-black ${className}`}>
      {children}
    </span>
  );
}

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

function buildTimeline(invoice) {
  const paymentStatus = String(invoice.payment?.status || "").toLowerCase();
  const dodoPaid = ["succeeded", "paid", "completed", "captured"].includes(paymentStatus);
  const state = normalizePaymentState(invoice.status);

  const steps = [
    {
      label: "Checkout Created",
      detail: invoice.payment?.checkoutUrl
        ? "Dodo checkout session created for buyer payment."
        : `${formatAmount(invoice.amount, invoice.currency)} contract opened for ${invoice.buyer}.`,
      done: Boolean(invoice.createdAt),
      date: invoice.checkout_created_at || invoice.createdAt
    },
    {
      label: "Fiat Payment Confirmed",
      detail: dodoPaid ? `Dodo checkout ${formatStatus(invoice.payment?.status)}.` : "Waiting for Dodo webhook confirmation.",
      done: [
        PAYMENT_STATES.FIAT_PAID,
        PAYMENT_STATES.TREASURY_FUNDING_PENDING,
        PAYMENT_STATES.ESCROW_FUNDED,
        PAYMENT_STATES.WORK_SUBMITTED,
        PAYMENT_STATES.RELEASED,
        PAYMENT_STATES.WITHDRAWN
      ].includes(state),
      date: invoice.fiat_paid_at || invoice.payment?.updatedAt
    },
    {
      label: "Treasury Funding Started",
      detail: "Treasury prepares the Anchor initialize and fund escrow instructions.",
      done: [
        PAYMENT_STATES.TREASURY_FUNDING_PENDING,
        PAYMENT_STATES.ESCROW_FUNDED,
        PAYMENT_STATES.WORK_SUBMITTED,
        PAYMENT_STATES.RELEASED,
        PAYMENT_STATES.WITHDRAWN
      ].includes(state),
      date: invoice.treasury_funding_started_at
    },
    {
      label: "Escrow Funded On-chain",
      detail: invoice.stablecoin?.vaultTokenAccount
        ? `USDC locked in Anchor vault ${shortHash(invoice.stablecoin.vaultTokenAccount)}.`
        : "Waiting for Anchor PDA vault funding.",
      done: [
        PAYMENT_STATES.ESCROW_FUNDED,
        PAYMENT_STATES.WORK_SUBMITTED,
        PAYMENT_STATES.RELEASED,
        PAYMENT_STATES.WITHDRAWN
      ].includes(state),
      date: invoice.escrow_funded_at || invoice.fiat_escrow?.fundedAt
    },
    {
      label: "Work Submitted",
      detail: state === PAYMENT_STATES.WORK_SUBMITTED ? "Seller marked work submitted." : "Seller work submission pending.",
      done: [
        PAYMENT_STATES.WORK_SUBMITTED,
        PAYMENT_STATES.RELEASED,
        PAYMENT_STATES.WITHDRAWN
      ].includes(state),
      date: invoice.work_submitted_at
    },
    {
      label: "Buyer Released Funds",
      detail: "Buyer approved release from the Anchor escrow vault.",
      done: [PAYMENT_STATES.RELEASED, PAYMENT_STATES.WITHDRAWN].includes(state),
      date: invoice.released_at
    },
    {
      label: "Seller Withdrawn",
      detail: state === PAYMENT_STATES.WITHDRAWN ? "Seller withdrew USDC from the escrow vault." : "Withdrawal becomes available after buyer release.",
      done: state === PAYMENT_STATES.WITHDRAWN,
      date: invoice.withdrawn_at || invoice.completed_at
    }
  ];

  return steps;
}

function Timeline({ invoice }) {
  const steps = buildTimeline(invoice);

  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-md">
      <p className="section-kicker">Payment Timeline</p>
      <div className="mt-6 grid gap-5">
        {steps.map((step, index) => (
          <div key={step.label} className="grid grid-cols-[2rem_1fr] gap-4">
            <div className="grid justify-items-center">
              <div className={`grid h-8 w-8 place-items-center rounded-full ${step.done ? "bg-leaf text-white" : "bg-black/10 text-black/35"}`}>
                {step.done ? <CheckCircle2 size={18} /> : <Circle size={14} />}
              </div>
              {index < steps.length - 1 && <div className="mt-2 h-full min-h-8 w-px bg-black/10" />}
            </div>
            <div className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-black text-ink">{step.label}</h3>
                <p className="text-xs font-bold text-black/35">{formatDate(step.date)}</p>
              </div>
              <p className="mt-1 text-sm font-semibold leading-6 text-black/55">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id;
  const [invoice, setInvoice] = useState(null);
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authMode, setAuthMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");

  const timeline = useMemo(() => (invoice ? buildTimeline(invoice) : []), [invoice]);
  const progress = Number(invoice?.payment_progress || 0);
  const escrowUrl = invoice?.stablecoin?.escrowExplorerUrl || explorerUrl(invoice?.stablecoin?.escrowTx);
  const releaseUrl = invoice?.stablecoin?.releaseExplorerUrl || explorerUrl(invoice?.stablecoin?.releaseTx);
  const invoiceStatus = normalizePaymentState(invoice?.status);

  useEffect(() => {
    setSession(getStoredSession());
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

  async function loadInvoice() {
    setError("");
    setLoading(true);
    try {
      setInvoice(await getInvoice(invoiceId));
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("login")) {
        setAuthMode("login");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!sessionReady) return;
    if (!session?.token) {
      setLoading(false);
      setAuthMode("login");
      return;
    }

    loadInvoice();
  }, [sessionReady, session?.token, invoiceId]);

  async function runInvoiceAction(action, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await action();
      setInvoice(updated.invoice || updated);
      setNotice(successMessage(updated));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function startDodoCheckout() {
    await runInvoiceAction(
      async () => {
        const result = await createDodoCheckout(invoice.id);
        if (result.checkout?.checkoutUrl) {
          window.location.assign(result.checkout.checkoutUrl);
        }
        return result;
      },
      () => "Dodo checkout created."
    );
  }

  async function fundEscrowFromTreasury() {
    await runInvoiceAction(
      () => fundDodoEscrowFromTreasury(invoice.id),
      () => "Treasury funded USDC escrow."
    );
  }

  async function withdrawFreelancerFunds() {
    await runInvoiceAction(
      async () => {
        const provider = getSolanaProvider();
        if (!provider) throw new Error("No Solana wallet detected. Open this with Phantom or another Solana wallet installed.");
        const connected = await provider.connect();
        const sellerWallet = connected.publicKey?.toBase58?.() || provider.publicKey?.toBase58?.();
        if (!sellerWallet) throw new Error("Unable to read connected seller wallet.");
        if (sellerWallet !== invoice.seller_wallet) throw new Error("Connected wallet does not match this invoice seller wallet.");

        const prepared = await prepareSellerWithdraw(invoice.id, sellerWallet);
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
        return confirmSellerWithdraw(invoice.id, signature, sellerWallet);
      },
      () => "Seller withdrew USDC."
    );
  }

  async function releaseEscrowFunds() {
    await runInvoiceAction(
      () => releaseAnchorEscrow(invoice.id),
      () => "Buyer released Anchor escrow."
    );
  }

  async function removeInvoice() {
    const confirmed = window.confirm("Delete this invoice?");
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      await deleteInvoice(invoice.id);
      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function handleAuthSuccess(result) {
    setSession(saveSession(result));
    setAuthMode(null);
    setError("");
  }

  async function copyTrackingLink() {
    setShareBusy(true);
    setError("");
    setNotice("");

    try {
      const result = await createInvoiceShareLink(invoice.id);
      setInvoice(result.invoice || invoice);
      setTrackingUrl(result.trackingUrl);

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.trackingUrl);
        setNotice("Live tracking link copied. You can share it with the seller.");
      } else {
        window.prompt("Copy live tracking link", result.trackingUrl);
        setNotice("Live tracking link generated.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <>
      <Navbar />
      <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSuccess={handleAuthSuccess} />
      <main className="container-shell py-10">
        <Link href="/dashboard" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-black/55 hover:text-ink">
          <ArrowLeft size={16} />
          Back to dashboard
        </Link>

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

        {loading ? (
          <div className="grid min-h-96 place-items-center rounded-xl border border-black/10 bg-white shadow-md">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-leaf border-t-transparent" />
          </div>
        ) : !invoice ? (
          <div className="grid min-h-96 place-items-center rounded-xl border border-black/10 bg-white p-8 text-center shadow-md">
            <div>
              <p className="section-kicker">Invoice</p>
              <h1 className="mt-2 text-3xl font-black text-ink">Invoice not available</h1>
              <button onClick={() => setAuthMode("login")} className="button-primary mt-6">Login</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section id="invoice-print-area" className="rounded-xl border border-black/10 bg-white p-6 shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <p className="section-kicker">Invoice Detail</p>
                  <h1 className="mt-3 text-4xl font-black tracking-tight text-ink">{invoice.id}</h1>
                  <p className="mt-3 text-black/55">
                    {invoice.buyer} paying {invoice.seller}
                  </p>
                </div>
                <p className="text-3xl font-black text-ink">{formatAmount(invoice.amount, invoice.currency)}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Pill className={statusStyles[normalizePaymentState(invoice.status)] || statusStyles.draft}>{paymentStateLabel(invoice.status)}</Pill>
                <Pill className="bg-mint text-ink">Dodo to Anchor escrow</Pill>
                <Pill className={riskStyles[invoice.risk?.risk_level || "Low"]}>
                  {invoice.risk?.risk_level || "Low"} risk - {invoice.risk?.risk_score || 0}
                </Pill>
                {invoice.payment?.status && ![PAYMENT_STATES.DRAFT, "not_started"].includes(invoice.payment.status) && <Pill className="bg-purple-100 text-purple-800">Dodo {String(invoice.payment?.status).replaceAll("_", " ")}</Pill>}
                {invoice.seller_payout?.status && normalizePaymentState(invoice.seller_payout?.status) !== PAYMENT_STATES.DRAFT && (
                  <Pill className={statusStyles[normalizePaymentState(invoice.seller_payout?.status)] || "bg-orange-100 text-orange-800"}>
                    Withdrawal {formatStatus(invoice.seller_payout?.status)}
                  </Pill>
                )}
                {invoice.stablecoin?.status && normalizePaymentState(invoice.stablecoin?.status) !== PAYMENT_STATES.DRAFT && <Pill className="bg-emerald-100 text-emerald-800">Vault {formatStatus(invoice.stablecoin?.status)}</Pill>}
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-3">
                <div className="rounded-xl bg-mint p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Buyer</p>
                  <p className="mt-2 font-black text-ink">{invoice.buyer}</p>
                </div>
                <div className="rounded-xl bg-mint p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Seller</p>
                  <p className="mt-2 font-black text-ink">{invoice.seller}</p>
                </div>
                <div className="rounded-xl bg-mint p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Progress</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
                    <div className="h-full rounded-full bg-leaf" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-2 font-black text-ink">{progress}% paid</p>
                </div>
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-black/10 p-5">
                  <p className="section-kicker">Split Escrow</p>
                  <p className="mt-3 font-bold text-black/60">Upfront: {formatAmount(invoice.upfront_amount, invoice.currency)} ({invoice.upfront_percentage || 50}%)</p>
                  <p className="mt-2 font-bold text-black/60">Remaining: {formatAmount(invoice.remaining_amount, invoice.currency)}</p>
                </div>
                <div className="rounded-xl border border-black/10 p-5">
                  <p className="section-kicker">AI Recommendation</p>
                  <p className="mt-3 text-sm font-semibold leading-6 text-black/60">{invoice.risk?.recommendation}</p>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3 border-t border-black/5 pt-5">
                {(!invoice.payment?.checkoutUrl ? (
                  <button onClick={startDodoCheckout} disabled={busy || invoiceStatus !== PAYMENT_STATES.DRAFT} className="button-primary gap-2">
                    {busy ? <Loader2 className="animate-spin" size={17} /> : <ExternalLink size={17} />}
                    Pay with Dodo
                  </button>
                ) : (
                  <a href={invoice.payment.checkoutUrl} className="button-primary gap-2" target="_blank" rel="noreferrer">
                    <ExternalLink size={17} />
                    Open Dodo checkout
                  </a>
                ))}
                <button
                  onClick={() => runInvoiceAction(() => syncDodoPayment(invoice.id), () => "Dodo payment status synced.")}
                  disabled={busy || !invoice.payment?.sessionId}
                  className="button-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}
                  Sync Dodo
                </button>
                {[PAYMENT_STATES.FIAT_PAID, PAYMENT_STATES.TREASURY_FUNDING_PENDING].includes(invoiceStatus) && (
                  <button onClick={fundEscrowFromTreasury} disabled={busy || !invoice.seller_wallet} className="button-primary gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                    Retry escrow funding
                  </button>
                )}
                {[PAYMENT_STATES.ESCROW_FUNDED, PAYMENT_STATES.WORK_SUBMITTED].includes(invoiceStatus) && (
                  <button onClick={releaseEscrowFunds} disabled={busy || !invoice.seller_wallet} className="button-primary gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                    Release escrow
                  </button>
                )}
                {invoiceStatus === PAYMENT_STATES.RELEASED && (
                  <button onClick={withdrawFreelancerFunds} disabled={busy || !invoice.seller_wallet} className="button-primary gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                    Withdraw USDC
                  </button>
                )}
                <button onClick={() => window.print()} className="button-secondary gap-2">
                  <Printer size={16} />
                  Print / Save PDF
                </button>
                <button onClick={copyTrackingLink} disabled={shareBusy} className="button-secondary gap-2">
                  {shareBusy ? <Loader2 className="animate-spin" size={16} /> : trackingUrl ? <Copy size={16} /> : <Share2 size={16} />}
                  {trackingUrl ? "Copy tracking link" : "Share live tracking"}
                </button>
                <button onClick={removeInvoice} disabled={busy} className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-5 py-3 text-sm font-black text-red-700">
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>

              {(escrowUrl || releaseUrl || invoice.stablecoin?.buyerWallet || invoice.stablecoin?.sellerWallet) && (
                <div className="mt-6 rounded-xl bg-mint p-5 text-sm font-semibold text-black/55">
                  <p className="section-kicker">USDC Trace</p>
                  {invoice.stablecoin?.buyerWallet && <p className="mt-3">From: {shortHash(invoice.stablecoin.buyerWallet)}</p>}
                  {invoice.stablecoin?.sellerWallet && <p className="mt-1">To: {shortHash(invoice.stablecoin.sellerWallet)}</p>}
                  <div className="mt-3 flex flex-wrap gap-3">
                    {escrowUrl && <a className="font-black text-leaf underline" href={escrowUrl} target="_blank" rel="noreferrer">Escrow tx</a>}
                    {releaseUrl && <a className="font-black text-leaf underline" href={releaseUrl} target="_blank" rel="noreferrer">Release tx</a>}
                  </div>
                </div>
              )}
              {(
                <div className="mt-6 rounded-xl border border-orange-100 bg-orange-50 p-5 text-sm font-semibold text-orange-900/75">
                  <p className="section-kicker text-orange-700">Anchor escrow pipeline</p>
                  <p className="mt-3">
                    Dodo confirms fiat first. Then the SettleFlow treasury locks USDC in an Anchor vault, the buyer releases it, and the seller withdraws on-chain.
                  </p>
                  <p className="mt-2 font-black text-orange-950">
                    Escrow status: {formatStatus(invoice.fiat_escrow?.status || PAYMENT_STATES.DRAFT)}
                  </p>
                  <p className="mt-1 font-black text-orange-950">
                    Withdrawal status: {formatStatus(invoice.seller_payout?.status || PAYMENT_STATES.DRAFT)}
                  </p>
                  {!invoice.seller_wallet && <p className="mt-2 font-black text-red-700">Missing seller wallet. Create Dodo invoices with a seller Solana wallet for Anchor escrow withdrawal.</p>}
                  {invoice.fiat_escrow?.treasuryTx && <p className="mt-2">Treasury funding: {invoice.fiat_escrow.treasuryTx}</p>}
                  {invoice.seller_payout?.reference && <p className="mt-2">Reference: {invoice.seller_payout.reference}</p>}
                  {invoice.seller_payout?.explorerUrl && <a className="mt-2 inline-flex font-black text-leaf underline" href={invoice.seller_payout.explorerUrl} target="_blank" rel="noreferrer">Withdrawal tx</a>}
                  {invoice.seller_payout?.paidAt && <p className="mt-2">Paid at: {formatDate(invoice.seller_payout.paidAt)}</p>}
                </div>
              )}
            </section>

            <aside className="grid content-start gap-6">
              <Timeline invoice={invoice} />
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 shadow-md">
                <p className="text-sm font-black text-yellow-800">Running on Devnet (Test Mode)</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-yellow-900/70">
                  Use devnet wallets and test payment methods only. This page is for verifying the settlement flow before production hardening.
                </p>
                <p className="sr-only">{timeline.length} timeline steps loaded.</p>
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
