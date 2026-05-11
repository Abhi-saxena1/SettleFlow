import OpenAI from "openai";

function getRiskLevel(score) {
  return score < 35 ? "Low" : score < 70 ? "Medium" : "High";
}

function summarizeHistory(history = []) {
  const paid = history.filter((item) => item.status === "paid").length;
  const late = history.filter((item) => item.status === "late").length;
  const disputed = history.filter((item) => item.status === "disputed").length;
  const amounts = history.map((item) => Number(item.amount || 0)).filter((value) => Number.isFinite(value));
  const settlementHours = history
    .map((item) => Number(item.settledInHours || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    paid,
    late,
    disputed,
    count: history.length,
    averageAmount: amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : 10000,
    averageSettlementHours: settlementHours.length
      ? settlementHours.reduce((sum, value) => sum + value, 0) / settlementHours.length
      : 24
  };
}

function buildRiskNarrative({ amount, history = [], score, riskLevel }) {
  const numericAmount = Number(amount || 0);
  const historySummary = summarizeHistory(history);
  const ratio = numericAmount / Math.max(historySummary.averageAmount, 1);
  const amountLabel = `${numericAmount.toLocaleString()} USDC`;
  const drivers = [
    `Invoice value is ${ratio.toFixed(1)}x the buyer's average historical transaction.`,
    `${historySummary.late} late and ${historySummary.disputed} disputed payments found across ${historySummary.count} prior transactions.`,
    `Average historical settlement time is ${Math.round(historySummary.averageSettlementHours)} hours.`
  ];

  if (numericAmount >= 50000) {
    drivers.unshift("Very large invoice size increases exposure before delivery is confirmed.");
  } else if (numericAmount >= 25000) {
    drivers.unshift("Large invoice size needs stronger release controls.");
  } else if (numericAmount < 500) {
    drivers.unshift("Small invoice size keeps payment exposure limited.");
  }

  const actions = riskLevel === "Low"
    ? [
        "Approve escrow funding with the standard release workflow.",
        "Keep delivery confirmation attached before final seller withdrawal.",
        "Monitor for unusual delays because the buyer has at least one late payment.",
        "Use normal dispute windows unless the invoice scope changes."
      ]
    : riskLevel === "Medium"
      ? [
          "Fund escrow, but keep release approval manual.",
          "Request delivery evidence before seller withdrawal.",
          "Confirm buyer authorization for the full invoice amount.",
          "Split settlement into milestone releases if delivery risk is unclear."
        ]
      : [
          "Pause automatic release until buyer and seller verification is complete.",
          "Request signed delivery acceptance and updated commercial documents.",
          "Use milestone-based escrow or reduce the initial funded amount.",
          "Escalate to manual review before funds are released."
        ];

  const recommendation = riskLevel === "Low"
    ? `Approve escrow funding for ${amountLabel}. Score ${score} reflects limited exposure with manageable buyer history signals.`
    : riskLevel === "Medium"
      ? `Review ${amountLabel} before release. Score ${score} indicates enough payment or amount pressure to require delivery evidence.`
      : `Request additional verification before funding or releasing ${amountLabel}. Score ${score} indicates elevated settlement risk.`;

  return { recommendation, risk_drivers: drivers, suggested_actions: actions };
}

function fallbackRiskScore(amount, history = []) {
  const numericAmount = Number(amount || 0);
  const historySummary = summarizeHistory(history);
  const amountPressure = Math.min(45, Math.round(Math.log10(numericAmount + 1) * 8));
  const relativePressure = Math.min(24, Math.round((numericAmount / Math.max(historySummary.averageAmount, 1)) * 7));
  const settlementDelayPenalty = Math.min(12, Math.round(Math.max(0, historySummary.averageSettlementHours - 24) / 8));
  const microInvoiceDiscount = numericAmount < 100 ? -6 : numericAmount < 500 ? -7 : 0;
  const largeInvoicePenalty = numericAmount >= 50000 ? 14 : numericAmount >= 25000 ? 8 : numericAmount >= 10000 ? 4 : 0;
  const score = Math.max(
    1,
    Math.min(
      95,
      4 +
        amountPressure +
        relativePressure +
        settlementDelayPenalty +
        microInvoiceDiscount +
        largeInvoicePenalty +
        historySummary.late * 8 +
        historySummary.disputed * 24
    )
  );
  const riskLevel = getRiskLevel(score);
  const narrative = buildRiskNarrative({ amount: numericAmount, history, score, riskLevel });

  return {
    risk_score: score,
    risk_level: riskLevel,
    ...narrative,
    analyzed_amount: numericAmount
  };
}

function normalizeRisk(payload, amount, history) {
  const fallback = fallbackRiskScore(amount, history);
  const blendedScore = Number.isFinite(Number(payload?.risk_score))
    ? Math.max(1, Math.min(95, Math.round((Number(payload.risk_score) + fallback.risk_score * 2) / 3)))
    : fallback.risk_score;
  const riskLevel = getRiskLevel(blendedScore);
  const narrative = buildRiskNarrative({ amount, history, score: blendedScore, riskLevel });

  return {
    risk_score: blendedScore,
    risk_level: riskLevel,
    recommendation: payload?.recommendation || narrative.recommendation,
    risk_drivers: Array.isArray(payload?.risk_drivers) && payload.risk_drivers.length
      ? payload.risk_drivers.slice(0, 5)
      : narrative.risk_drivers,
    suggested_actions: Array.isArray(payload?.suggested_actions) && payload.suggested_actions.length
      ? payload.suggested_actions.slice(0, 5)
      : narrative.suggested_actions,
    analyzed_amount: Number(amount || 0)
  };
}

export async function analyzeRisk({ amount, buyerHistory = [] }) {
  const deterministicRisk = fallbackRiskScore(amount, buyerHistory);

  if (!process.env.OPENAI_API_KEY) {
    return deterministicRisk;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a B2B payments risk analyst. Return only JSON with risk_score number from 1-100, risk_level Low|Medium|High, recommendation string, risk_drivers array, and suggested_actions array. The score must be sensitive to invoice amount, buyer history, late/disputed payments, relative invoice size, and settlement delays."
        },
        {
          role: "user",
          content: JSON.stringify({
            amount: Number(amount || 0),
            fallback_reference_score: deterministicRisk.risk_score,
            instruction:
              "The risk_score must change when invoice amount materially changes. Mention this exact amount in the recommendation.",
            buyer_transaction_history: buyerHistory
          })
        }
      ],
      temperature: 0.2
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return normalizeRisk(parsed, amount, buyerHistory);
  } catch (error) {
    console.error("OpenAI risk scoring failed, using fallback:", error.message);
    return deterministicRisk;
  }
}
