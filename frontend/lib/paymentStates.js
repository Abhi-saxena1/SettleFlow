export const PAYMENT_STATES = Object.freeze({
  DRAFT: "draft",
  CHECKOUT_PENDING: "checkout_pending",
  FIAT_PAID: "fiat_paid",
  TREASURY_FUNDING_PENDING: "treasury_funding_pending",
  ESCROW_FUNDED: "escrow_funded",
  WORK_SUBMITTED: "work_submitted",
  RELEASE_PENDING: "release_pending",
  RELEASED: "released",
  WITHDRAWN: "withdrawn",
  REFUNDED: "refunded",
  DISPUTED: "disputed"
});

export const PAYMENT_STATE_ORDER = [
  PAYMENT_STATES.DRAFT,
  PAYMENT_STATES.CHECKOUT_PENDING,
  PAYMENT_STATES.FIAT_PAID,
  PAYMENT_STATES.TREASURY_FUNDING_PENDING,
  PAYMENT_STATES.ESCROW_FUNDED,
  PAYMENT_STATES.WORK_SUBMITTED,
  PAYMENT_STATES.RELEASE_PENDING,
  PAYMENT_STATES.RELEASED,
  PAYMENT_STATES.WITHDRAWN
];

export const TERMINAL_PAYMENT_STATES = new Set([
  PAYMENT_STATES.WITHDRAWN,
  PAYMENT_STATES.REFUNDED,
  PAYMENT_STATES.DISPUTED
]);

export const LEGACY_PAYMENT_STATE_MAP = Object.freeze({
  Pending: PAYMENT_STATES.DRAFT,
  "Partially Funded": PAYMENT_STATES.ESCROW_FUNDED,
  Funded: PAYMENT_STATES.ESCROW_FUNDED,
  "Fiat Paid": PAYMENT_STATES.FIAT_PAID,
  "Escrow Funded": PAYMENT_STATES.ESCROW_FUNDED,
  Completed: PAYMENT_STATES.WITHDRAWN,
  completed: PAYMENT_STATES.WITHDRAWN,
  created: PAYMENT_STATES.DRAFT,
  partially_funded: PAYMENT_STATES.ESCROW_FUNDED,
  fully_funded: PAYMENT_STATES.ESCROW_FUNDED,
  awaiting_release: PAYMENT_STATES.RELEASE_PENDING
});

export function normalizePaymentState(status) {
  const value = String(status || "").trim();
  if (!value) return PAYMENT_STATES.DRAFT;
  if (Object.values(PAYMENT_STATES).includes(value)) return value;
  return LEGACY_PAYMENT_STATE_MAP[value] || PAYMENT_STATES.DRAFT;
}

export function paymentStateRank(status) {
  const normalized = normalizePaymentState(status);
  const index = PAYMENT_STATE_ORDER.indexOf(normalized);
  return index === -1 ? 0 : index;
}

export function canTransitionPaymentState(current, next) {
  const currentState = normalizePaymentState(current);
  const nextState = normalizePaymentState(next);
  if (currentState === nextState) return true;
  if (currentState === PAYMENT_STATES.DISPUTED) return nextState === PAYMENT_STATES.DISPUTED;
  if (currentState === PAYMENT_STATES.REFUNDED) return nextState === PAYMENT_STATES.REFUNDED;
  if (nextState === PAYMENT_STATES.DISPUTED || nextState === PAYMENT_STATES.REFUNDED) return true;
  return paymentStateRank(nextState) > paymentStateRank(currentState);
}

export function paymentStateLabel(status) {
  return normalizePaymentState(status)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
