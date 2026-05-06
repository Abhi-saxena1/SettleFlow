"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink, RefreshCw } from "lucide-react";
import Navbar from "../../../components/Navbar";
import { getTrackedInvoice } from "../../../lib/api";

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

function explorerUrl(signature) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : "";
}

function Pill({ children, className }) {
  return <span className={`inline-flex rounded-full px-4 py-2 text-xs font-black ${className}`}>{children}</span>;
}

function buildTimeline(invoice) {
  const paymentStatus = String(invoice.payment?.status || "").toLowerCase();
  const dodoPaid = ["succeeded", "payment_succeeded", "paid", "completed", "captured"].includes(paymentStatus);
  const hasDodoActivity = Boolean(invoice.payment?.status !== "not_started" && invoice.payment?.status);
  const hasUsdcActivity = Boolean(invoice.upfront_paid || invoice.remaining_paid || invoice.stablecoin?.status === "released");
  const steps = [
    {
      label: "Invoice created",
      detail: `${formatAmount(invoice.amount, invoice.currency)} invoice opened for ${invoice.buyer}.`,
      done: Boolean(invoice.createdAt),
      date: invoice.createdAt
    },
    {
      label: "Risk reviewed",
      detail: `${invoice.risk?.risk_level || "Low"} risk score ${invoice.risk?.risk_score || 0}.`,
      done: Boolean(invoice.risk),
      date: invoice.createdAt
    }
  ];

  if (hasUsdcActivity || invoice.payment_method === "usdc") {
    steps.push(
      {
        label: "Upfront USDC locked",
        detail: `${formatAmount(invoice.upfront_amount, invoice.currency)} ${invoice.upfront_paid ? "locked in escrow" : "waiting for escrow"}.`,
        done: Boolean(invoice.upfront_paid),
        date: invoice.funded_at
      },
      {
        label: "Remaining USDC locked",
        detail: `${formatAmount(invoice.remaining_amount, invoice.currency)} ${invoice.remaining_paid ? "locked in escrow" : "waiting for escrow"}.`,
        done: Boolean(invoice.remaining_paid),
        date: invoice.remaining_paid ? invoice.funded_at : null
      }
    );
  }

  if (hasDodoActivity || invoice.payment_method === "dodo") {
    steps.push({
      label: "Dodo card payment",
      detail: `Dodo checkout ${formatStatus(invoice.payment?.status)}.`,
      done: dodoPaid,
      date: invoice.payment?.updatedAt || invoice.payment?.createdAt
    });
  }

  steps.push({
    label: "Settlement completed",
    detail: invoice.status === "Completed" ? "Invoice settled." : "Waiting for completion.",
    done: invoice.status === "Completed",
    date: invoice.completed_at
  });

  return steps;
}

function Timeline({ invoice }) {
  const steps = buildTimeline(invoice);
  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-md">
      <p className="section-kicker">Live Payment Timeline</p>
      <div className="mt-6 grid gap-5">
        {steps.map((step, index) => (
          <div key={step.label} className="grid grid-cols-[2rem_1fr] gap-4">
            <div className="grid justify-items-center">
              <div className={`grid h-8 w-8 place-items-center rounded-full ${step.done ? "bg-leaf text-white" : "bg-black/10 text-black/35"}`}>
                {step.done ? <CheckCircle2 size={18} /> : <Circle size={14} />}
              </div>
              {index < steps.length - 1 && <div className="mt-2 h-full min-h-8 w-px bg-black/10" />}
            </div>
            <div>
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

export default function TrackInvoicePage({ params }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const progress = Number(invoice?.payment_progress || 0);
  const escrowUrl = invoice?.stablecoin?.escrowExplorerUrl || explorerUrl(invoice?.stablecoin?.escrowTx);
  const releaseUrl = invoice?.stablecoin?.releaseExplorerUrl || explorerUrl(invoice?.stablecoin?.releaseTx);

  async function loadTrackedInvoice({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError("");

    try {
      setInvoice(await getTrackedInvoice(params.token));
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    loadTrackedInvoice();
    const interval = window.setInterval(() => loadTrackedInvoice({ quiet: true }), 8000);
    return () => window.clearInterval(interval);
  }, [params.token]);

  const amountLabel = useMemo(() => invoice ? formatAmount(invoice.amount, invoice.currency) : "", [invoice]);

  return (
    <>
      <Navbar />
      <main className="container-shell py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="section-kicker">Seller Tracking</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-ink">Live invoice status</h1>
            <p className="mt-3 max-w-2xl text-black/55">
              This read-only link refreshes automatically so the seller can track payment and settlement progress.
            </p>
          </div>
          <button onClick={() => loadTrackedInvoice()} className="button-secondary gap-2">
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        {loading ? (
          <div className="grid min-h-96 place-items-center rounded-xl border border-black/10 bg-white shadow-md">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-leaf border-t-transparent" />
          </div>
        ) : invoice && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-xl border border-black/10 bg-white p-6 shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <p className="section-kicker">Invoice</p>
                  <h2 className="mt-3 text-4xl font-black tracking-tight text-ink">{invoice.id}</h2>
                  <p className="mt-3 text-black/55">{invoice.buyer} paying {invoice.seller}</p>
                </div>
                <p className="text-3xl font-black text-ink">{amountLabel}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Pill className={statusStyles[invoice.status] || statusStyles.Pending}>{invoice.status}</Pill>
                <Pill className="bg-mint text-ink">{invoice.payment_method === "dodo" ? "Dodo card rail" : "USDC escrow rail"}</Pill>
                <Pill className={riskStyles[invoice.risk?.risk_level || "Low"]}>
                  {invoice.risk?.risk_level || "Low"} risk - {invoice.risk?.risk_score || 0}
                </Pill>
              </div>

              <div className="mt-8 rounded-xl bg-mint p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Payment progress</p>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-3 text-2xl font-black text-ink">{progress}% paid</p>
                <p className="mt-2 text-sm font-semibold text-black/55">
                  Upfront {formatAmount(invoice.upfront_amount, invoice.currency)} · Remaining {formatAmount(invoice.remaining_amount, invoice.currency)}
                </p>
              </div>

              {(escrowUrl || releaseUrl) && (
                <div className="mt-6 rounded-xl border border-black/10 p-5">
                  <p className="section-kicker">Public Transaction Links</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {escrowUrl && <a className="button-secondary gap-2" href={escrowUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Escrow tx</a>}
                    {releaseUrl && <a className="button-secondary gap-2" href={releaseUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Release tx</a>}
                  </div>
                </div>
              )}

              <p className="mt-6 text-xs font-bold text-black/35">
                Last updated {lastUpdated ? formatDate(lastUpdated.toISOString()) : "just now"}. Auto-refreshes every 8 seconds.
              </p>
            </section>

            <aside className="grid content-start gap-6">
              <Timeline invoice={invoice} />
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 shadow-md">
                <p className="text-sm font-black text-yellow-800">Read-only seller view</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-yellow-900/70">
                  This page does not allow invoice edits, fund release, wallet actions, or account access.
                </p>
              </div>
            </aside>
          </div>
        )}

        <Link href="/" className="mt-8 inline-flex text-sm font-black text-leaf underline">
          Powered by SettleFlow
        </Link>
      </main>
    </>
  );
}
