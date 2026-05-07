"use client";

import { useEffect } from "react";
import { getBrowserSupabase } from "./supabaseClient";

export function useInvoiceRealtime({ invoiceId, onInvoiceChange, onEvent }) {
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase || !invoiceId) {
      return undefined;
    }

    const channel = supabase
      .channel(`settleflow-invoice-${invoiceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices", filter: `id=eq.${invoiceId}` },
        (payload) => onInvoiceChange?.(payload)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "invoice_events", filter: `invoice_id=eq.${invoiceId}` },
        (payload) => onEvent?.(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [invoiceId, onInvoiceChange, onEvent]);
}
