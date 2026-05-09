"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";
import Navbar from "./Navbar";
import { confirmTrackedSellerWithdraw, getStablecoinConfig, getTrackedInvoice, prepareTrackedSellerWithdraw } from "../lib/api";
import { useInvoiceRealtime } from "../lib/useInvoiceRealtime";
import { PAYMENT_STATES, normalizePaymentState, paymentStateLabel } from "../lib/paymentStates";

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
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatStatus(value) {
  return paymentStateLabel(value);
}

function explorerUrl(signature) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : "";
}

function Pill({ children, className }) {
  return <span className={`inline-flex rounded-full px-4 py-2 text-xs font-black ${className}`}>{children}</span>;
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
  const dodoPaid = ["succeeded", "payment_succeeded", "paid", "completed", "captured"].includes(paymentStatus);
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
      detail: dodoPaid ? `Dodo checkout ${String(invoice.payment?.status).replaceAll("_", " ")}.` : "Waiting for Dodo webhook confirmation.",
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
        ? `USDC locked in Anchor vault ${invoice.stablecoin.vaultTokenAccount.slice(0, 6)}...${invoice.stablecoin.vaultTokenAccount.slice(-4)}.`
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
      detail: [PAYMENT_STATES.RELEASED, PAYMENT_STATES.WITHDRAWN].includes(state)
        ? "Work accepted before buyer release."
        : state === PAYMENT_STATES.WORK_SUBMITTED
          ? "Seller marked work submitted."
          : "Seller work submission pending.",
      done: [PAYMENT_STATES.WORK_SUBMITTED, PAYMENT_STATES.RELEASED, PAYMENT_STATES.WITHDRAWN].includes(state),
      date: invoice.work_submitted_at || ([PAYMENT_STATES.RELEASED, PAYMENT_STATES.WITHDRAWN].includes(state) ? invoice.released_at : null)
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
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const sellerPayoutUrl = invoice?.seller_payout?.explorerUrl || explorerUrl(invoice?.seller_payout?.reference);
  const amountLabel = useMemo(() => invoice ? formatAmount(invoice.amount, invoice.currency) : "", [invoice]);
  const invoiceStatus = normalizePaymentState(invoice?.status);

  async function withdrawAsSeller() {
    setWithdrawBusy(true);
    setError("");
    setNotice("");

    try {
      const provider = getSolanaProvider();
      if (!provider) throw new Error("No Solana wallet detected. Open this with Phantom or another Solana wallet installed.");
      const connected = await provider.connect();
      const sellerWallet = connected.publicKey?.toBase58?.() || provider.publicKey?.toBase58?.();
      if (!sellerWallet) throw new Error("Unable to read connected seller wallet.");

      const prepared = await prepareTrackedSellerWithdraw(token, sellerWallet);
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
      setInvoice(await confirmTrackedSellerWithdraw(token, signature, sellerWallet));
      setNotice("Seller withdrawal confirmed on-chain.");
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setWithdrawBusy(false);
    }
  }

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
        {notice && <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">{notice}</div>}

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
                <Pill className={statusStyles[normalizePaymentState(invoice.status)] || statusStyles.draft}>{formatStatus(invoice.status)}</Pill>
                <Pill className="bg-mint text-ink">Dodo to Anchor escrow</Pill>
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
                <p className="mt-2 text-sm font-semibold text-black/55">Full invoice escrow amount: {formatAmount(invoice.amount, invoice.currency)}</p>
              </div>

              {(escrowUrl || releaseUrl || sellerPayoutUrl) && (
                <div className="mt-6 rounded-xl border border-black/10 p-5">
                  <p className="section-kicker">Transaction Hashes</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {escrowUrl && <a className="button-secondary gap-2" href={escrowUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Escrow tx</a>}
                    {releaseUrl && <a className="button-secondary gap-2" href={releaseUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Release tx</a>}
                    {sellerPayoutUrl && <a className="button-secondary gap-2" href={sellerPayoutUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Withdrawal tx</a>}
                  </div>
                </div>
              )}

              {invoiceStatus === PAYMENT_STATES.RELEASED && (
                <div className="mt-6 rounded-xl border border-leaf/20 bg-mint p-5">
                  <p className="section-kicker">Seller Withdrawal</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-black/55">
                    Funds are released. Connect the seller wallet assigned to this invoice and withdraw USDC from the Anchor vault.
                  </p>
                  <button onClick={withdrawAsSeller} disabled={withdrawBusy} className="button-primary mt-4 gap-2 disabled:cursor-not-allowed disabled:opacity-60">
                    {withdrawBusy ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
                    Withdraw USDC as seller
                  </button>
                </div>
              )}

              <p className="mt-6 text-xs font-bold text-black/35">
                Last updated {lastUpdated ? formatDate(lastUpdated.toISOString()) : "just now"}. Realtime updates enabled when Supabase Realtime env vars are configured.
              </p>
            </section>

            <aside className="grid content-start gap-6">
              <Timeline invoice={invoice} />
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 shadow-md">
                <p className="text-sm font-black text-yellow-800">Seller-safe tracking view</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-yellow-900/70">
                  This page never exposes service role keys. Seller withdrawal requires the seller wallet signature.
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
