"use client";

import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";

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

const paymentStyles = {
  not_started: "bg-gray-100 text-gray-700",
  checkout_created: "bg-purple-100 text-purple-800",
  processing: "bg-blue-100 text-blue-800",
  succeeded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-700"
};

const stablecoinStyles = {
  not_started: "bg-gray-100 text-gray-700",
  upfront_locked: "bg-emerald-100 text-emerald-800",
  escrow_locked: "bg-emerald-100 text-emerald-800",
  released: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800"
};

function StatusPill({ children, className }) {
  return (
    <span className={`inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-xs font-black leading-none ${className}`}>
      {children}
    </span>
  );
}

function formatAmount(value, currency = "USDC") {
  return `${Number(value || 0).toLocaleString()} ${currency}`;
}

function formatStatusLabel(value) {
  return String(value || "not_started").replaceAll("_", " ");
}

function PaymentBreakdown({ invoice }) {
  const currency = invoice.currency || "USDC";
  const progress = Number(invoice.payment_progress || 0);

  return (
    <div className="grid gap-2 text-xs font-semibold text-black/55">
      <div className="h-2 overflow-hidden rounded-full bg-black/10">
        <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid gap-1">
        <p>Upfront: {formatAmount(invoice.upfront_amount, currency)} ({invoice.upfront_percentage || 50}%)</p>
        <p>Remaining: {formatAmount(invoice.remaining_amount, currency)}</p>
        <p className="font-black text-ink">{progress}% paid</p>
      </div>
    </div>
  );
}

function dodoAmountMismatch(invoice) {
  const intendedAmountMinor = Number(invoice.payment?.intendedAmountMinor || 0);
  const invoiceAmountMinor = Math.round(Number(invoice.amount || 0) * 100);

  return intendedAmountMinor > 0 && invoiceAmountMinor > 0 && intendedAmountMinor !== invoiceAmountMinor;
}

function shortHash(value) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "";
}

function explorerUrl(signature) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : "";
}

function StablecoinDetails({ invoice }) {
  const stablecoin = invoice.stablecoin || {};
  const escrowUrl = stablecoin.escrowExplorerUrl || explorerUrl(stablecoin.escrowTx);
  const releaseUrl = stablecoin.releaseExplorerUrl || explorerUrl(stablecoin.releaseTx);

  if (!stablecoin.escrowTx && !stablecoin.releaseTx && !stablecoin.buyerWallet && !stablecoin.sellerWallet) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold leading-5 text-black/40">
      {stablecoin.buyerWallet && <p className="max-w-[11rem] truncate" title={stablecoin.buyerWallet}>From: {shortHash(stablecoin.buyerWallet)}</p>}
      {stablecoin.sellerWallet && <p className="max-w-[11rem] truncate" title={stablecoin.sellerWallet}>To: {shortHash(stablecoin.sellerWallet)}</p>}
      {stablecoin.destinationTokenAccount && (
        <p className="max-w-[12rem] truncate" title={stablecoin.destinationTokenAccount}>
          Token acct: {shortHash(stablecoin.destinationTokenAccount)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {escrowUrl && (
          <a href={escrowUrl} target="_blank" rel="noreferrer" className="font-black text-leaf underline">
            Escrow tx
          </a>
        )}
        {releaseUrl && (
          <a href={releaseUrl} target="_blank" rel="noreferrer" className="font-black text-leaf underline">
            Release tx
          </a>
        )}
      </div>
    </div>
  );
}

function InvoiceActions({
  invoice,
  busyId,
  onDelete,
  onDodoCheckout,
  onFundStablecoin,
  onReleaseStablecoin,
  onSyncPayment
}) {
  const actionBusy = busyId === invoice.id;

  if (invoice.status === "Completed") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-black/40">Settled</span>
        <button
          onClick={() => onDelete(invoice.id)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-100 bg-red-50 text-red-700 hover:-translate-y-0.5"
          disabled={actionBusy}
          title="Delete invoice"
        >
          {actionBusy ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
        </button>
      </div>
    );
  }

  if (invoice.status === "Funded") {
    const stablecoinLocked = invoice.stablecoin?.status === "escrow_locked";

    return stablecoinLocked ? (
      <button onClick={() => onReleaseStablecoin(invoice.id)} className="button-primary h-11 gap-2 px-5 py-0 leading-none" disabled={actionBusy}>
        {actionBusy ? <Loader2 className="animate-spin" size={16} /> : "Release USDC"}
      </button>
    ) : (
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => onDelete(invoice.id)} className="text-xs font-bold text-red-600 underline" disabled={actionBusy}>
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!invoice.payment?.checkoutUrl ? (
        <button
          onClick={() => onDodoCheckout(invoice.id)}
          className="button-primary h-11 gap-2 px-5 py-0 leading-none"
          disabled={actionBusy}
          title="Create a real Dodo Payments checkout session"
        >
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : <ExternalLink size={16} />}
          Pay with Dodo
        </button>
      ) : (
        <>
          <a href={invoice.payment.checkoutUrl} target="_blank" rel="noreferrer" className="button-secondary h-11 gap-2 px-5 py-0 leading-none">
            <ExternalLink size={16} />
            Open
          </a>
          <button
            onClick={() => onSyncPayment(invoice.id)}
            className="button-secondary px-3 py-2"
            disabled={actionBusy}
            title="Sync Dodo payment status"
          >
            {actionBusy ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          </button>
        </>
      )}
      {!invoice.upfront_paid && (
        <button
          onClick={() => onFundStablecoin(invoice, "upfront")}
          className="button-primary h-11 gap-2 px-5 py-0 leading-none"
          disabled={actionBusy}
          title="Transfer the upfront USDC amount from your wallet to escrow"
        >
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : "Lock Upfront USDC"}
        </button>
      )}
      {invoice.upfront_paid && !invoice.remaining_paid && (
        <button
          onClick={() => onFundStablecoin(invoice, "remaining")}
          className="button-primary h-11 gap-2 px-5 py-0 leading-none"
          disabled={actionBusy}
          title="Transfer the remaining USDC balance from your wallet to escrow"
        >
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : "Lock Remaining USDC"}
        </button>
      )}
      <button
        onClick={() => onDelete(invoice.id)}
        className="inline-flex h-11 items-center gap-1 rounded-full px-2 text-xs font-bold text-red-600 underline"
        disabled={actionBusy}
      >
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  );
}

function InvoiceCard({
  invoice,
  busyId,
  onDelete,
  onDodoCheckout,
  onFundStablecoin,
  onReleaseStablecoin,
  onSyncPayment
}) {
  const paymentStatus = invoice.payment?.status || "not_started";
  const stablecoinStatus = invoice.stablecoin?.status || "not_started";
  const showPaymentStatus = paymentStatus !== "not_started";
  const showStablecoinStatus = stablecoinStatus !== "not_started";

  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Invoice</p>
          <Link href={`/dashboard/invoice/${invoice.id}`} className="mt-1 block text-lg font-black text-ink hover:text-leaf">
            {invoice.id}
          </Link>
        </div>
        <p className="text-xl font-black text-ink">{formatAmount(invoice.amount, invoice.currency || "USDC")}</p>
      </div>

      <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.15fr]">
        <div>
          <p className="font-bold text-black/40">Buyer</p>
          <p className="mt-1 font-semibold text-black/70">{invoice.buyer}</p>
        </div>
        <div>
          <p className="font-bold text-black/40">Seller</p>
          <p className="mt-1 font-semibold text-black/70">{invoice.seller}</p>
        </div>
        <div>
          <p className="font-bold text-black/40">Split</p>
          <div className="mt-2">
            <PaymentBreakdown invoice={invoice} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusPill className={statusStyles[invoice.status] || statusStyles.Pending}>{invoice.status}</StatusPill>
        <StatusPill className={riskStyles[invoice.risk?.risk_level || "Low"]}>
          {invoice.risk?.risk_level || "Low"} - {invoice.risk?.risk_score || 0}
        </StatusPill>
        {showPaymentStatus && (
          <StatusPill className={paymentStyles[paymentStatus] || paymentStyles.not_started}>
            Dodo {formatStatusLabel(paymentStatus)}
          </StatusPill>
        )}
        {showStablecoinStatus && (
          <StatusPill className={stablecoinStyles[stablecoinStatus] || stablecoinStyles.not_started}>
            USDC {formatStatusLabel(stablecoinStatus)}
          </StatusPill>
        )}
      </div>
      <StablecoinDetails invoice={invoice} />

      <div className="mt-5 border-t border-black/5 pt-4">
        <Link href={`/dashboard/invoice/${invoice.id}`} className="button-secondary mb-3 h-11 gap-2 px-5 py-0 leading-none">
          View details
        </Link>
        <InvoiceActions
          invoice={invoice}
          busyId={busyId}
          onDelete={onDelete}
          onDodoCheckout={onDodoCheckout}
          onFundStablecoin={onFundStablecoin}
          onReleaseStablecoin={onReleaseStablecoin}
          onSyncPayment={onSyncPayment}
        />
      </div>
    </article>
  );
}

export default function InvoiceTable({
  invoices,
  onDodoCheckout,
  onDelete,
  onFundStablecoin,
  onReleaseStablecoin,
  onSyncPayment,
  busyId
}) {
  return (
    <div className="w-full min-w-0">
      <div className="grid gap-4">
        {invoices.map((invoice) => (
          <InvoiceCard
            key={invoice.id}
            invoice={invoice}
            busyId={busyId}
            onDelete={onDelete}
            onDodoCheckout={onDodoCheckout}
            onFundStablecoin={onFundStablecoin}
            onReleaseStablecoin={onReleaseStablecoin}
            onSyncPayment={onSyncPayment}
          />
        ))}
      </div>
    </div>
  );
}
