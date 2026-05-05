import OpenAI from "openai";

function fallbackRiskScore(amount, history = []) {
  const numericAmount = Number(amount || 0);
  const latePayments = history.filter((item) => item.status === "late").length;
  const disputedPayments = history.filter((item) => item.status === "disputed").length;
  const amountPressure = Math.min(50, Math.floor(numericAmount / 2000));
  const largeInvoicePenalty = numericAmount >= 50000 ? 12 : numericAmount >= 25000 ? 6 : 0;
  const score = Math.min(95, 10 + amountPressure + largeInvoicePenalty + latePayments * 12 + disputedPayments * 24);

  if (score < 35) {
    return {
      risk_score: score,
      risk_level: "Low",
      recommendation: `Approve escrow funding. ${numericAmount.toLocaleString()} USDC is within the low-risk range for this buyer history.`,
      analyzed_amount: numericAmount
    };
  }

  if (score < 70) {
    return {
      risk_score: score,
      risk_level: "Medium",
      recommendation: `Fund escrow for ${numericAmount.toLocaleString()} USDC, but require delivery confirmation and keep release approval manual.`,
      analyzed_amount: numericAmount
    };
  }

  return {
    risk_score: score,
    risk_level: "High",
    recommendation: `Request additional verification before funding or releasing the ${numericAmount.toLocaleString()} USDC escrow.`,
    analyzed_amount: numericAmount
  };
}

function normalizeRisk(payload, amount, history) {
  const fallback = fallbackRiskScore(amount, history);
  const riskLevel = ["Low", "Medium", "High"].includes(payload?.risk_level)
    ? payload.risk_level
    : fallback.risk_level;

  return {
    risk_score: Number.isFinite(Number(payload?.risk_score))
      ? Math.max(0, Math.min(100, Math.round(Number(payload.risk_score))))
      : fallback.risk_score,
    risk_level: riskLevel,
    recommendation: payload?.recommendation || fallback.recommendation,
    analyzed_amount: Number(amount || 0)
  };
}

export async function analyzeRisk({ amount, buyerHistory = [] }) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackRiskScore(amount, buyerHistory);
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
            "You are a fintech risk analyst. Return only JSON with risk_score number, risk_level Low|Medium|High, and recommendation string."
        },
        {
          role: "user",
          content: JSON.stringify({
            amount: Number(amount || 0),
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
    return fallbackRiskScore(amount, buyerHistory);
  }
}
