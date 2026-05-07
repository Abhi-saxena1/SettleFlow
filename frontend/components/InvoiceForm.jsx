"use client";

import { useState } from "react";
import { CreditCard, Loader2, Plus, Wallet } from "lucide-react";
import { createInvoice } from "../lib/api";

export default function InvoiceForm({ disabled = false, onCreated, onError, onLoginRequired }) {
  const [form, setForm] = useState({
    title: "Website launch escrow",
    description: "Escrow-protected payment for completed SME project delivery.",
    amount: "15000",
    buyer: "Northstar Retail",
    seller: "Atlas Components",
    buyer_email: "",
    seller_email: "",
    seller_wallet: "",
    due_date: "",
    upfront_percentage: "50",
    allow_partial_funding: true,
    payment_method: "usdc"
  });
  const [loading, setLoading] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitInvoice(event) {
    event.preventDefault();

    if (disabled) {
      onLoginRequired?.();
      return;
    }

    setLoading(true);
    try {
      const invoice = await createInvoice({
        ...form,
        amount: Number(form.amount),
        upfront_percentage: Number(form.upfront_percentage)
      });
      onCreated(invoice);
      setForm((current) => ({ ...current, amount: "" }));
    } catch (err) {
      onError?.(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="create" onSubmit={submitInvoice} className="rounded-xl border border-black/10 bg-white p-6 shadow-md">
      <div className="mb-5">
        <p className="section-kicker">Create</p>
        <h2 className="mt-2 text-2xl font-black text-ink">New invoice</h2>
      </div>
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Invoice title
          <input
            required
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Description
          <textarea
            rows={3}
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
            className="resize-none rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Amount
          <input
            required
            min="1"
            type="number"
            value={form.amount}
            onChange={(event) => updateField("amount", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Buyer
          <input
            required
            value={form.buyer}
            onChange={(event) => updateField("buyer", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Seller
          <input
            required
            value={form.seller}
            onChange={(event) => updateField("seller", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm font-bold text-black/55">
            Buyer email
            <input
              type="email"
              value={form.buyer_email}
              onChange={(event) => updateField("buyer_email", event.target.value)}
              className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
              placeholder="buyer@company.com"
            />
          </label>
          <label className="grid gap-2 text-sm font-bold text-black/55">
            Seller email
            <input
              type="email"
              value={form.seller_email}
              onChange={(event) => updateField("seller_email", event.target.value)}
              className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
              placeholder="seller@company.com"
            />
          </label>
        </div>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Seller wallet address
          <input
            value={form.seller_wallet}
            onChange={(event) => updateField("seller_wallet", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
            placeholder="Solana wallet for USDC release"
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Due date
          <input
            type="date"
            value={form.due_date}
            onChange={(event) => updateField("due_date", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-xl bg-mint p-4 text-sm font-bold text-black/65">
          Allow partial funding
          <input
            type="checkbox"
            checked={form.allow_partial_funding}
            onChange={(event) => updateField("allow_partial_funding", event.target.checked)}
            className="h-5 w-5 accent-leaf"
          />
        </label>
        <label className="grid gap-2 text-sm font-bold text-black/55">
          Upfront %
          <input
            required
            min="1"
            max="99"
            type="number"
            value={form.upfront_percentage}
            onChange={(event) => updateField("upfront_percentage", event.target.value)}
            className="rounded-xl border border-black/10 px-4 py-3 text-base font-semibold text-ink outline-none focus:border-leaf"
          />
        </label>
        <div className="grid gap-2 text-sm font-bold text-black/55">
          Payment method
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-mint p-1">
            <button
              type="button"
              onClick={() => updateField("payment_method", "usdc")}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-black ${form.payment_method === "usdc" ? "bg-ink text-white shadow-sm" : "text-ink hover:bg-white"}`}
            >
              <Wallet size={16} />
              USDC Escrow
            </button>
            <button
              type="button"
              onClick={() => updateField("payment_method", "dodo")}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm font-black ${form.payment_method === "dodo" ? "bg-ink text-white shadow-sm" : "text-ink hover:bg-white"}`}
            >
              <CreditCard size={16} />
              Dodo Card
            </button>
          </div>
        </div>
      </div>
      <button className="button-primary mt-6 w-full gap-2" disabled={loading}>
        {loading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
        Create with AI score
      </button>
    </form>
  );
}
