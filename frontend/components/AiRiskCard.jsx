"use client";

import { useRef, useState } from "react";
import { Brain, CheckCircle2, Loader2, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { analyzeRisk } from "../lib/api";

export default function AiRiskCard() {
  const requestIdRef = useRef(0);
  const [amount, setAmount] = useState(28000);
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runRiskAnalysis() {
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid invoice amount.");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    setRisk(null);

    try {
      const result = await analyzeRisk({
        amount: numericAmount,
        buyerHistory: [
          { amount: 7600, status: "paid", settledInHours: 5 },
          { amount: 18400, status: "paid", settledInHours: 16 },
          { amount: 22000, status: "late", settledInHours: 90 }
        ]
      });

      if (requestId === requestIdRef.current) {
        setRisk(result);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err.message);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  return (
    <section id="risk" className="container-shell overflow-hidden py-14 sm:py-20">
      <div className="animate-reveal grid w-full max-w-full overflow-hidden rounded-[1.8rem] bg-[#c8dc94] p-3 shadow-glow sm:p-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="paper-grid relative min-w-0 rounded-[1.25rem] p-6 text-ink sm:p-8 lg:p-10">
          <div className="pointer-events-none absolute inset-x-6 bottom-6 h-px bg-gradient-to-r from-leaf/40 via-white/10 to-transparent sm:inset-x-8 sm:bottom-8" />
          <div className="mb-6 inline-flex max-w-full items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm">
            <Brain size={17} className="text-leaf" />
            AI Risk Analysis
          </div>
          <h2 className="max-w-sm text-3xl font-black tracking-tight sm:text-4xl">Risk-check invoices.</h2>
          <p className="mt-5 max-w-xl leading-7 text-black/60">
            Review invoice size, buyer history, risk drivers, and next actions before releasing funds.
          </p>
        </div>
        <div className="min-w-0 p-3 sm:p-8 lg:p-10">
          <div className="w-full min-w-0 rounded-[1.25rem] border border-black/10 bg-white p-4 shadow-md hover:-translate-y-1 hover:shadow-glow sm:p-6">
            <label className="text-sm font-bold text-black/55" htmlFor="risk-amount">Invoice amount</label>
            <div className="mt-2 grid gap-3 sm:flex">
              <input
                id="risk-amount"
                className="w-full min-w-0 rounded-xl border border-black/10 px-4 py-3 text-lg font-bold outline-none focus:border-leaf sm:flex-1"
                type="number"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setRisk(null);
                  setError("");
                }}
              />
              <button onClick={runRiskAnalysis} className="button-primary w-full sm:min-w-28 sm:w-auto" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" size={18} /> : "Analyze"}
              </button>
            </div>
            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {error}
              </div>
            )}
            <div className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="shimmer-surface rounded-xl bg-sage p-5">
                <p className="text-sm font-bold text-black/50">Risk Score</p>
                <p className="mt-2 text-5xl font-black text-ink">{loading || !risk ? "--" : risk.risk_score}</p>
              </div>
              <div className="shimmer-surface min-w-0 rounded-xl bg-mint p-5">
                <p className="text-sm font-bold text-black/50">Risk Level</p>
                <p className="mt-2 break-words text-3xl font-black text-ink">{loading || !risk ? "Analyzing" : risk.risk_level}</p>
              </div>
            </div>
            <div className="mt-4 flex min-w-0 gap-3 rounded-xl border border-black/10 p-4">
              <ShieldAlert className="mt-1 shrink-0 text-leaf" size={22} />
              <div className="min-w-0">
                <p className="font-black text-ink">Recommendation</p>
                <p className="mt-1 leading-7 text-black/60">
                  {loading || !risk ? "Running fresh analysis for this invoice amount..." : risk.recommendation}
                </p>
                {risk?.analyzed_amount && !loading && (
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-black/35">
                    Analyzed amount: {Number(risk.analyzed_amount).toLocaleString()} USDC
                  </p>
                )}
              </div>
            </div>
            {!loading && risk?.risk_drivers?.length > 0 && (
              <div className="mt-4 rounded-xl border border-black/10 p-4">
                <div className="mb-3 flex items-center gap-2 font-black text-ink">
                  <SlidersHorizontal className="text-leaf" size={19} />
                  Risk drivers
                </div>
                <div className="space-y-2">
                  {risk.risk_drivers.map((driver) => (
                    <p key={driver} className="rounded-lg bg-sage/70 px-3 py-2 text-sm font-semibold leading-6 text-black/65">
                      {driver}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {!loading && risk?.suggested_actions?.length > 0 && (
              <div className="mt-4 rounded-xl border border-black/10 p-4">
                <div className="mb-3 flex items-center gap-2 font-black text-ink">
                  <CheckCircle2 className="text-leaf" size={19} />
                  Suggested actions
                </div>
                <div className="space-y-2">
                  {risk.suggested_actions.map((action) => (
                    <p key={action} className="rounded-lg bg-mint/70 px-3 py-2 text-sm font-semibold leading-6 text-black/65">
                      {action}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
