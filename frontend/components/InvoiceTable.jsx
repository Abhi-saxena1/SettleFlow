"use client";

import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { PAYMENT_STATES, normalizePaymentState } from "../lib/paymentStates";

function formatAmount(value, currency = "USDC") {
  return `${Number(value || 0).toLocaleString()} ${currency}`;
}

function FundingProgress({ invoice }) {
  const progress = Number(invoice.payment_progress || 0);

  return (
    <div className="grid gap-1.5 text-xs font-semibold text-black/55">
      <div className="h-2 overflow-hidden rounded-full bg-black/10">
        <div className="h-full rounded-full bg-leaf transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="font-black text-ink">{progress}% funded</p>
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
  onReleaseStablecoin,
  onWithdrawFreelancer,
  onSyncPayment
}) {
  const actionBusy = busyId === invoice.id;
  const status = normalizePaymentState(invoice.status);
  const fundingError = invoice.fiat_escrow?.fundingError || invoice.stablecoin?.fundingError;

  if (status === PAYMENT_STATES.WITHDRAWN) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-black/40">Withdrawn</span>
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

  if (status === PAYMENT_STATES.FIAT_PAID || status === PAYMENT_STATES.TREASURY_FUNDING_PENDING) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex min-h-10 items-center rounded-full px-4 py-2 text-xs font-black ${fundingError ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-800"}`}
          title={fundingError || "Treasury is securing escrow on-chain."}
        >
          {fundingError ? "Insufficient balance" : "Securing escrow..."}
        </span>
        <button onClick={() => onSyncPayment(invoice.id)} className="button-secondary px-3 py-2" disabled={actionBusy}>
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
        </button>
      </div>
    );
  }

  if (status === PAYMENT_STATES.ESCROW_FUNDED || status === PAYMENT_STATES.WORK_SUBMITTED) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onReleaseStablecoin(invoice.id)} className="button-primary h-10 gap-2 px-4 py-0 leading-none" disabled={actionBusy || !invoice.seller_wallet}>
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : "Release escrow"}
        </button>
      </div>
    );
  }

  if (status === PAYMENT_STATES.RELEASED) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => onWithdrawFreelancer(invoice.id)} className="button-primary h-10 gap-2 px-4 py-0 leading-none" disabled={actionBusy || !invoice.seller_wallet}>
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : "Withdraw USDC"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(!invoice.payment?.checkoutUrl ? (
        <button
          onClick={() => onDodoCheckout(invoice.id)}
          className="button-primary h-10 gap-2 px-4 py-0 leading-none"
          disabled={actionBusy}
          title="Create a real Dodo Payments checkout session"
        >
          {actionBusy ? <Loader2 className="animate-spin" size={16} /> : <ExternalLink size={16} />}
          Pay with Dodo
        </button>
      ) : (
        <>
          <a href={invoice.payment.checkoutUrl} target="_blank" rel="noreferrer" className="button-secondary h-10 gap-2 px-4 py-0 leading-none">
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
      ))}
      <button
        onClick={() => onDelete(invoice.id)}
        className="inline-flex h-10 items-center gap-1 rounded-full px-2 text-xs font-bold text-red-600 underline"
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
  onReleaseStablecoin,
  onWithdrawFreelancer,
  onSyncPayment
}) {
  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 shadow-md">
      <div className="grid gap-4 xl:grid-cols-[minmax(8rem,0.8fr)_minmax(8rem,0.75fr)_minmax(8rem,0.75fr)_minmax(13rem,1.15fr)] xl:items-start">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-black/35">Invoice</p>
          <Link href={`/dashboard/invoice/${invoice.id}`} className="mt-1 block text-lg font-black text-ink hover:text-leaf">
            {invoice.id}
          </Link>
          <p className="mt-2 text-lg font-black text-ink">{formatAmount(invoice.amount, invoice.currency || "USDC")}</p>
        </div>
        <div>
          <p className="font-bold text-black/40">Buyer</p>
          <p className="mt-1 text-sm font-semibold text-black/70">{invoice.buyer}</p>
        </div>
        <div>
          <p className="font-bold text-black/40">Seller</p>
          <p className="mt-1 text-sm font-semibold text-black/70">{invoice.seller}</p>
        </div>
        <div>
          <p className="font-bold text-black/40">Funding</p>
          <div className="mt-2">
            <FundingProgress invoice={invoice} />
          </div>
        </div>
      </div>

      <StablecoinDetails invoice={invoice} />

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        <Link href={`/dashboard/invoice/${invoice.id}`} className="button-secondary h-10 gap-2 px-4 py-0 leading-none">
          View details
        </Link>
        <InvoiceActions
          invoice={invoice}
          busyId={busyId}
          onDelete={onDelete}
          onDodoCheckout={onDodoCheckout}
          onReleaseStablecoin={onReleaseStablecoin}
          onWithdrawFreelancer={onWithdrawFreelancer}
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
  onReleaseStablecoin,
  onWithdrawFreelancer,
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
            onReleaseStablecoin={onReleaseStablecoin}
            onWithdrawFreelancer={onWithdrawFreelancer}
            onSyncPayment={onSyncPayment}
          />
        ))}
      </div>
    </div>
  );
}
