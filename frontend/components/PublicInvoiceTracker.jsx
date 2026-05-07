"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import Navbar from "./Navbar";
import { getTrackedInvoice } from "../lib/api";
import { useInvoiceRealtime } from "../lib/useInvoiceRealtime";

const statusStyles = {
  created: "bg-yellow-100 text-yellow-800",
  Pending: "bg-yellow-100 text-yellow-800",
  partially_funded: "bg-emerald-100 text-emerald-800",
  "Partially Funded": "bg-emerald-100 text-emerald-800",
  fully_funded: "bg-blue-100 text-blue-800",
  Funded: "bg-blue-100 text-blue-800",
  awaiting_release: "bg-blue-100 text-blue-800",
  released: "bg-green-100 text-green-800",
  completed: "bg-green-100 text-green-800",
  Completed: "bg-green-100 text-green-800",
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
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatStatus(value) {
  return String(value || "created").replaceAll("_", " ");
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
  const paymentMethod = invoice.payment_method || "usdc";
  const isDodoInvoice = paymentMethod === "dodo";
  const steps = [
    {
      label: "Invoice created",
      detail: `${formatAmount(invoice.amount, invoice.currency)} invoice opened for ${invoice.buyer}.`,
      done: Boolean(invoice.createdAt),
      date: invoice.createdAt
    },
    {
      label: "Escrow protection enabled",
      detail: "Funds are tracked against a SettleFlow escrow invoice.",
      done: invoice.escrow_enabled !== false,
      date: invoice.createdAt
    },
  ];

  if (isDodoInvoice) {
    steps.push({
      label: "Dodo card payment",
      detail: `Card checkout ${formatStatus(invoice.payment?.status)}.`,
      done: dodoPaid,
      date: invoice.payment?.updatedAt || invoice.payment?.createdAt
    });
    steps.push({
      label: "Seller payout",
      detail: invoice.seller_payout?.status === "seller_paid"
        ? `Seller payout completed${invoice.seller_payout?.reference ? ` (${invoice.seller_payout.reference})` : ""}.`
        : "Platform payout to seller is pending.",
      done: invoice.seller_payout?.status === "seller_paid",
      date: invoice.seller_payout?.paidAt || invoice.seller_payout?.updatedAt
    });
  } else {
    steps.push(
      {
        label: "Upfront USDC funded",
        detail: `${formatAmount(invoice.upfront_amount, invoice.currency)} ${invoice.upfront_paid ? "funded" : "pending"}.`,
        done: Boolean(invoice.upfront_paid),
        date: invoice.funded_at
      },
      {
        label: "Remaining USDC funded",
        detail: `${formatAmount(invoice.remaining_amount, invoice.currency)} ${invoice.remaining_paid ? "funded" : "pending"}.`,
        done: Boolean(invoice.remaining_paid),
        date: invoice.remaining_paid ? invoice.funded_at : null
      }
    );
  }

  steps.push({
    label: "Funds released",
    detail: invoice.status === "Completed" || invoice.status === "released"
      ? isDodoInvoice
        ? invoice.seller_payout?.status === "seller_paid"
          ? "Buyer payment and seller payout completed."
          : "Buyer payment completed. Seller payout pending."
        : "Seller payout completed."
      : isDodoInvoice
        ? "Awaiting Dodo payment completion."
        : "Awaiting buyer release.",
    done: invoice.status === "Completed" || invoice.status === "released",
    date: invoice.completed_at
  });

  return steps;
}

function Timeline({ invoice }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white/90 p-6 shadow-md backdrop-blur">
      <p className="section-kicker">Activity Timeline</p>
      <div className="mt-6 grid gap-5">
        {buildTimeline(invoice).map((step, index, steps) => (
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

export default function PublicInvoiceTracker({ token }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadTrackedInvoice = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");

    try {
      setInvoice(await getTrackedInvoice(token));
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadTrackedInvoice();
    const interval = window.setInterval(() => loadTrackedInvoice({ quiet: true }), 8000);
    return () => window.clearInterval(interval);
  }, [loadTrackedInvoice]);

  useInvoiceRealtime({
    invoiceId: invoice?.id,
    onInvoiceChange: () => loadTrackedInvoice({ quiet: true }),
    onEvent: () => loadTrackedInvoice({ quiet: true })
  });

  const progress = Number(invoice?.payment_progress || 0);
  const escrowUrl = invoice?.stablecoin?.escrowExplorerUrl || explorerUrl(invoice?.stablecoin?.escrowTx);
  const releaseUrl = invoice?.stablecoin?.releaseExplorerUrl || explorerUrl(invoice?.stablecoin?.releaseTx);
  const amountLabel = useMemo(() => invoice ? formatAmount(invoice.amount, invoice.currency) : "", [invoice]);

  return (
    <>
      <Navbar />
      <main className="container-shell py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="section-kicker">Escrow Protected Invoice</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-ink">Live invoice status</h1>
            <p className="mt-3 max-w-2xl text-black/55">Read-only payment link with realtime settlement updates.</p>
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
            <section className="rounded-xl border border-white/60 bg-white/80 p-6 shadow-md backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-leaf/25 bg-mint px-4 py-2 text-sm font-black text-ink">
                    <ShieldCheck size={17} className="text-leaf" />
                    Escrow protected
                  </div>
                  <h2 className="mt-4 text-4xl font-black tracking-tight text-ink">{invoice.title || invoice.id}</h2>
                  <p className="mt-2 font-black text-black/45">{invoice.id}</p>
                  <p className="mt-3 max-w-2xl text-black/55">{invoice.description || `${invoice.buyer} paying ${invoice.seller}`}</p>
                </div>
                <p className="text-3xl font-black text-ink">{amountLabel}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Pill className={statusStyles[invoice.status] || statusStyles.created}>{formatStatus(invoice.status)}</Pill>
                <Pill className="bg-mint text-ink">{invoice.payment_method === "dodo" ? "Dodo card rail" : "USDC escrow rail"}</Pill>
                <Pill className={riskStyles[invoice.risk?.risk_level || "Low"]}>{invoice.risk?.risk_level || "Low"} risk</Pill>
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-3">
                <div className="rounded-xl bg-mint p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Client</p>
                  <p className="mt-2 font-black text-ink">{invoice.buyer}</p>
                </div>
                <div className="rounded-xl bg-mint p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Seller</p>
                  <p className="mt-2 font-black text-ink">{invoice.seller}</p>
                </div>
                <div className="rounded-xl bg-mint p-5">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Due date</p>
                  <p className="mt-2 font-black text-ink">{invoice.due_date || "Open"}</p>
                </div>
              </div>

              <div className="mt-8 rounded-xl bg-mint p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Funding progress</p>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-3 text-2xl font-black text-ink">{progress}% funded</p>
                <p className="mt-2 text-sm font-semibold text-black/55">
                  Upfront {formatAmount(invoice.upfront_amount, invoice.currency)} / Remaining {formatAmount(invoice.remaining_amount, invoice.currency)}
                </p>
              </div>

              {(escrowUrl || releaseUrl) && (
                <div className="mt-6 rounded-xl border border-black/10 p-5">
                  <p className="section-kicker">Transaction Hashes</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {escrowUrl && <a className="button-secondary gap-2" href={escrowUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Escrow tx</a>}
                    {releaseUrl && <a className="button-secondary gap-2" href={releaseUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Release tx</a>}
                  </div>
                </div>
              )}

              <p className="mt-6 text-xs font-bold text-black/35">
                Last updated {lastUpdated ? formatDate(lastUpdated.toISOString()) : "just now"}. Realtime updates enabled when Supabase Realtime env vars are configured.
              </p>
            </section>

            <aside className="grid content-start gap-6">
              <Timeline invoice={invoice} />
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 shadow-md">
                <p className="text-sm font-black text-yellow-800">Read-only buyer/seller view</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-yellow-900/70">
                  This page never exposes service role keys and cannot edit invoices, release funds, or access the seller dashboard.
                </p>
              </div>
            </aside>
          </div>
        )}

        <Link href="/" className="mt-8 inline-flex text-sm font-black text-leaf underline">Powered by SettleFlow</Link>
      </main>
    </>
  );
}
