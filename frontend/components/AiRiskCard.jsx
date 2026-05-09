"use client";

import { useRef, useState } from "react";
import { Brain, Loader2, ShieldAlert } from "lucide-react";
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
    <section id="risk" className="container-shell py-20">
      <div className="animate-reveal grid overflow-hidden rounded-[1.8rem] bg-[#c8dc94] p-4 shadow-glow lg:grid-cols-[0.9fr_1.1fr]">
        <div className="paper-grid relative rounded-[1.25rem] p-8 text-ink sm:p-10 lg:p-12">
          <div className="pointer-events-none absolute inset-x-8 bottom-8 h-px bg-gradient-to-r from-leaf/40 via-white/10 to-transparent" />
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm">
            <Brain size={17} className="text-leaf" />
            AI Risk Analysis
          </div>
          <h2 className="text-4xl font-black tracking-tight sm:text-5xl">Approve the right payments faster.</h2>
          <p className="mt-5 leading-8 text-white/65">
            SettleFlow evaluates invoice amount and mock buyer history, then returns a structured risk score, level, and recommendation.
          </p>
        </div>
        <div className="p-4 sm:p-8 lg:p-10">
          <div className="rounded-[1.25rem] border border-black/10 bg-white p-6 shadow-md hover:-translate-y-1 hover:shadow-glow">
            <label className="text-sm font-bold text-black/55" htmlFor="risk-amount">Invoice amount</label>
            <div className="mt-2 flex gap-3">
              <input
                id="risk-amount"
                className="min-w-0 flex-1 rounded-xl border border-black/10 px-4 py-3 text-lg font-bold outline-none focus:border-leaf"
                type="number"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setRisk(null);
                  setError("");
                }}
              />
              <button onClick={runRiskAnalysis} className="button-primary min-w-28" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" size={18} /> : "Analyze"}
              </button>
            </div>
            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {error}
              </div>
            )}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="shimmer-surface rounded-xl bg-sage p-5">
                <p className="text-sm font-bold text-black/50">Risk Score</p>
                <p className="mt-2 text-5xl font-black text-ink">{loading || !risk ? "--" : risk.risk_score}</p>
              </div>
              <div className="shimmer-surface rounded-xl bg-mint p-5">
                <p className="text-sm font-bold text-black/50">Risk Level</p>
                <p className="mt-2 text-3xl font-black text-ink">{loading || !risk ? "Analyzing" : risk.risk_level}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-3 rounded-xl border border-black/10 p-4">
              <ShieldAlert className="mt-1 shrink-0 text-leaf" size={22} />
              <div>
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
          </div>
        </div>
      </div>
    </section>
  );
}
