"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Copy, ExternalLink, Loader2, Printer, RefreshCw, Share2, Trash2 } from "lucide-react";
import AuthModal from "../../../../components/AuthModal";
import Navbar from "../../../../components/Navbar";
import { createDodoCheckout, createInvoiceShareLink, deleteInvoice, getInvoice, syncDodoPayment } from "../../../../lib/api";
import { AUTH_CHANGED_EVENT, getStoredSession, saveSession } from "../../../../lib/authSession";

const statusStyles = {
  Pending: "bg-yellow-100 text-yellow-800",
  "Partially Funded": "bg-emerald-100 text-emerald-800",
  Funded: "bg-blue-100 text-blue-800",
  Completed: "bg-green-100 text-green-800"
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
  return String(value || "not_started").replaceAll("_", " ");
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

function buildTimeline(invoice) {
  const paymentStatus = String(invoice.payment?.status || "").toLowerCase();
  const dodoPaid = ["succeeded", "paid", "completed", "captured"].includes(paymentStatus);
  const hasDodoActivity = Boolean(invoice.payment?.checkoutUrl || invoice.payment?.sessionId || dodoPaid);
  const hasUsdcActivity = Boolean(
    invoice.stablecoin?.escrowTx ||
    invoice.stablecoin?.releaseTx ||
    invoice.upfront_paid ||
    invoice.remaining_paid ||
    invoice.stablecoin?.status === "released"
  );

  const steps = [
    {
      label: "Invoice created",
      detail: `${formatAmount(invoice.amount, invoice.currency)} invoice opened for ${invoice.buyer}.`,
      done: Boolean(invoice.createdAt),
      date: invoice.createdAt
    },
    {
      label: "AI risk analyzed",
      detail: `${invoice.risk?.risk_level || "Low"} risk score ${invoice.risk?.risk_score || 0}.`,
      done: Boolean(invoice.risk),
      date: invoice.risk?.generated_at || invoice.createdAt
    },
  ];

  if (hasUsdcActivity || !hasDodoActivity) {
    steps.push(
      {
        label: "Upfront USDC locked",
        detail: `${formatAmount(invoice.upfront_amount, invoice.currency)} upfront payment ${invoice.upfront_paid ? "locked in escrow" : "waiting for escrow"}.`,
        done: Boolean(invoice.upfront_paid),
        date: invoice.funded_at
      },
      {
        label: "Remaining USDC locked",
        detail: `${formatAmount(invoice.remaining_amount, invoice.currency)} remaining payment ${invoice.remaining_paid ? "locked in escrow" : "waiting for escrow"}.`,
        done: Boolean(invoice.remaining_paid),
        date: invoice.remaining_paid ? invoice.funded_at : null
      }
    );
  }

  if (hasDodoActivity) {
    steps.push({
      label: "Dodo card payment",
      detail: dodoPaid
        ? `Dodo checkout ${formatStatus(invoice.payment?.status)}.`
        : `Dodo checkout ${formatStatus(invoice.payment?.status || "created")}.`,
      done: dodoPaid,
      date: invoice.payment?.updatedAt || invoice.payment?.createdAt
    });
  }

  steps.push(
    {
      label: "Settlement completed",
      detail: invoice.status === "Completed" ? "Funds released and invoice completed." : "Waiting for final release.",
      done: invoice.status === "Completed",
      date: invoice.completed_at
    }
  );

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
  const paymentMethod = invoice?.payment_method || "usdc";

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
                <Pill className={statusStyles[invoice.status] || statusStyles.Pending}>{invoice.status}</Pill>
                <Pill className="bg-mint text-ink">{paymentMethod === "dodo" ? "Dodo card rail" : "USDC escrow rail"}</Pill>
                <Pill className={riskStyles[invoice.risk?.risk_level || "Low"]}>
                  {invoice.risk?.risk_level || "Low"} risk - {invoice.risk?.risk_score || 0}
                </Pill>
                {invoice.payment?.status !== "not_started" && <Pill className="bg-purple-100 text-purple-800">Dodo {formatStatus(invoice.payment?.status)}</Pill>}
                {invoice.stablecoin?.status !== "not_started" && <Pill className="bg-emerald-100 text-emerald-800">USDC {formatStatus(invoice.stablecoin?.status)}</Pill>}
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
                {paymentMethod === "dodo" && (!invoice.payment?.checkoutUrl ? (
                  <button onClick={startDodoCheckout} disabled={busy || invoice.status === "Completed"} className="button-primary gap-2">
                    {busy ? <Loader2 className="animate-spin" size={17} /> : <ExternalLink size={17} />}
                    Pay with Dodo
                  </button>
                ) : (
                  <a href={invoice.payment.checkoutUrl} className="button-primary gap-2" target="_blank" rel="noreferrer">
                    <ExternalLink size={17} />
                    Open Dodo checkout
                  </a>
                ))}
                {paymentMethod === "dodo" && <button
                  onClick={() => runInvoiceAction(() => syncDodoPayment(invoice.id), () => "Dodo payment status synced.")}
                  disabled={busy || !invoice.payment?.sessionId}
                  className="button-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? <Loader2 className="animate-spin" size={17} /> : <RefreshCw size={17} />}
                  Sync Dodo
                </button>}
                {paymentMethod === "usdc" && <Link href="/dashboard#create" className="button-primary">Manage USDC escrow</Link>}
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
