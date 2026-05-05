import { clearSession, getStoredSession } from "./authSession";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function authHeaders() {
  if (typeof window === "undefined") {
    return {};
  }

  const session = getStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

async function request(path, options = {}) {
  const apiPath = path.startsWith("/api") ? path : `/api${path}`;
  const response = await fetch(`${API_URL}${apiPath}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    if (response.status === 401 || error.error?.toLowerCase().includes("session expired")) {
      clearSession();
    }
    throw new Error(error.error || "Request failed");
  }

  return response.json();
}

export function getInvoices() {
  return request("/invoice/all");
}

export function importInvoices(invoices) {
  return request("/invoice/import", {
    method: "POST",
    body: JSON.stringify({ invoices })
  });
}

export function getAnalyticsSummary() {
  return request("/analytics/summary");
}

export function createInvoice(payload) {
  return request("/invoice/create", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fundInvoice(id) {
  return request("/invoice/fund", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function releaseInvoice(id) {
  return request("/invoice/release", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function deleteInvoice(id) {
  return request(`/invoice/${id}`, {
    method: "DELETE"
  });
}

export function payUpfront(id) {
  return request("/invoice/pay-upfront", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function payRemaining(id) {
  return request("/invoice/pay-remaining", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function createDodoCheckout(id) {
  return request("/invoice/checkout", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function syncDodoPayment(id) {
  return request("/invoice/payment/sync", {
    method: "POST",
    body: JSON.stringify({ id })
  });
}

export function getStablecoinConfig() {
  return request("/stablecoin/config");
}

export function fundStablecoinEscrow(id, buyerWallet, signature, paymentStage = "full") {
  return request("/stablecoin/fund", {
    method: "POST",
    body: JSON.stringify({ id, buyerWallet, signature, paymentStage })
  });
}

export function releaseStablecoinEscrow(id, sellerWallet) {
  return request("/stablecoin/release", {
    method: "POST",
    body: JSON.stringify({ id, sellerWallet })
  });
}

export function analyzeRisk(payload) {
  return request("/ai/risk", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function signUp(payload) {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logIn(payload) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function forgotPassword(payload) {
  return request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function resetPassword(payload) {
  return request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
