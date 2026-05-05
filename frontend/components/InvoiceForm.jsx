"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { createInvoice } from "../lib/api";

export default function InvoiceForm({ disabled = false, onCreated, onError, onLoginRequired }) {
  const [form, setForm] = useState({
    amount: "15000",
    buyer: "Northstar Retail",
    seller: "Atlas Components",
    upfront_percentage: "50"
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
      </div>
      <button className="button-primary mt-6 w-full gap-2" disabled={loading}>
        {loading ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
        Create with AI score
      </button>
    </form>
  );
}
