export const STORAGE_KEY = "settleflow_user";
export const AUTH_CHANGED_EVENT = "settleflow-auth-changed";
const INVOICE_CACHE_PREFIX = "settleflow_invoices_";

export function getStoredSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveSession(result) {
  const previousSession = getStoredSession();
  const session = {
    ...result.user,
    token: result.token
  };
  const previousKey = legacyInvoiceCacheKey(previousSession);
  const nextKey = invoiceCacheKey(session);

  if (previousKey && nextKey && previousKey !== nextKey) {
    const previousInvoices = window.localStorage.getItem(previousKey);
    const nextInvoices = window.localStorage.getItem(nextKey);

    if (previousInvoices && !nextInvoices) {
      window.localStorage.setItem(nextKey, previousInvoices);
    }
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: session }));
  return session;
}

export function clearSession() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: null }));
}

function invoiceCacheKey(session = getStoredSession()) {
  const accountKey = session?.email || session?.id;
  return accountKey ? `${INVOICE_CACHE_PREFIX}${String(accountKey).toLowerCase()}` : "";
}

function legacyInvoiceCacheKey(session) {
  return session?.id ? `${INVOICE_CACHE_PREFIX}${session.id}` : "";
}

export function getCachedInvoices(session) {
  if (typeof window === "undefined") {
    return [];
  }

  const key = invoiceCacheKey(session);
  if (!key) {
    return [];
  }

  try {
    return JSON.parse(window.localStorage.getItem(key) || "[]");
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
}

export function saveCachedInvoices(invoices, session) {
  if (typeof window === "undefined") {
    return;
  }

  const key = invoiceCacheKey(session);
  if (!key) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(invoices || []));
}
