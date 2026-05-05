import DodoPayments from "dodopayments";

export class DodoConfigurationError extends Error {
  constructor(message, statusCode = 503) {
    super(message);
    this.name = "DodoConfigurationError";
    this.statusCode = statusCode;
  }
}

function getDodoClient() {
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    return null;
  }

  return new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    environment: process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode",
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY || undefined
  });
}

export function dodoConfigured() {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY && process.env.DODO_PAYMENTS_PRODUCT_ID);
}

function invoiceAmountInMinorUnits(invoice) {
  const amount = Number(invoice.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DodoConfigurationError("Invoice amount must be greater than 0 before creating a Dodo checkout.", 400);
  }

  return Math.round(amount * 100);
}

function checkoutSessionUrl(session) {
  return session.checkout_url || session.url;
}

function checkoutSessionId(session) {
  return session.session_id || session.id;
}

function expectedAmountLabel(invoice) {
  return `${Number(invoice.amount).toLocaleString()} ${invoice.currency || "USDC"}`;
}

function createCheckoutPayload(invoice, productCartItem, returnUrl) {
  return {
    product_cart: [productCartItem],
    allowed_payment_method_types: ["credit", "debit"],
    billing_address: {
      country: process.env.DODO_PAYMENTS_BILLING_COUNTRY || "US"
    },
    billing_currency: process.env.DODO_PAYMENTS_CURRENCY || "USD",
    return_url: `${returnUrl}?invoice_id=${invoice.id}`,
    cancel_url: `${returnUrl}?invoice_id=${invoice.id}&status=cancelled`,
    short_link: true,
    metadata: {
      invoice_id: invoice.id,
      invoice_amount: String(invoice.amount),
      invoice_amount_minor: String(productCartItem.amount),
      buyer: invoice.buyer,
      seller: invoice.seller,
      settleflow_source: "dashboard"
    },
    customer: {
      email: `billing+${invoice.id.toLowerCase()}@settleflow.local`,
      name: invoice.buyer
    }
  };
}

async function assertDodoHonorsInvoiceAmount(client, checkoutPayload, invoiceAmountMinor, invoice) {
  if (process.env.DODO_PAYMENTS_VALIDATE_AMOUNT === "false") {
    return null;
  }

  try {
    const preview = await client.checkoutSessions.preview(checkoutPayload);
    const previewAmount = Number(preview.current_breakup?.total_amount || preview.total_price || 0);

    if (previewAmount > 0 && previewAmount < invoiceAmountMinor * 0.9) {
      throw new DodoConfigurationError(
        `Dodo is still using the fixed product price instead of the invoice amount. Expected checkout amount is ${expectedAmountLabel(invoice)} (${invoiceAmountMinor} cents), but Dodo preview returned ${previewAmount} cents. Enable Pay What You Want on your one-time Dodo product, set min/max high enough, then create a new checkout session.`,
        409
      );
    }

    return preview;
  } catch (error) {
    if (error instanceof DodoConfigurationError) {
      throw error;
    }

    console.warn("Dodo checkout preview failed; creating session without preview validation:", error.message);
    return null;
  }
}

export async function createDodoCheckoutSession(invoice) {
  const returnUrl = process.env.DODO_PAYMENTS_RETURN_URL || "http://localhost:3000/dashboard";

  if (!dodoConfigured()) {
    throw new DodoConfigurationError(
      "Dodo Payments is not configured. Add DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_PRODUCT_ID to backend/.env."
    );
  }

  const client = getDodoClient();
  const invoiceAmountMinor = invoiceAmountInMinorUnits(invoice);
  const productCartItem = {
    product_id: process.env.DODO_PAYMENTS_PRODUCT_ID,
    quantity: 1,
    amount: invoiceAmountMinor
  };

  if (process.env.DODO_PAYMENTS_USE_INVOICE_AMOUNT === "false") {
    delete productCartItem.amount;
  }

  const checkoutPayload = createCheckoutPayload(invoice, productCartItem, returnUrl);
  const preview = productCartItem.amount
    ? await assertDodoHonorsInvoiceAmount(client, checkoutPayload, invoiceAmountMinor, invoice)
    : null;
  const session = await client.checkoutSessions.create(checkoutPayload);

  return {
    provider: "dodo",
    mode: process.env.DODO_PAYMENTS_ENVIRONMENT || "test_mode",
    sessionId: checkoutSessionId(session),
    checkoutUrl: checkoutSessionUrl(session),
    status: "checkout_created",
    intendedAmount: Number(invoice.amount),
    intendedAmountMinor: invoiceAmountMinor,
    previewAmountMinor: preview?.current_breakup?.total_amount || preview?.total_price || null,
    currency: process.env.DODO_PAYMENTS_CURRENCY || "USD"
  };
}

export async function retrieveDodoCheckoutSession(sessionId) {
  if (!dodoConfigured()) {
    throw new DodoConfigurationError(
      "Dodo Payments is not configured. Add DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_PRODUCT_ID to backend/.env."
    );
  }

  const client = getDodoClient();
  return client.checkoutSessions.retrieve(sessionId);
}

export function unwrapDodoWebhook(rawBody, headers) {
  const client = getDodoClient();

  if (!client || !process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
    return JSON.parse(rawBody);
  }

  return client.webhooks.unwrap(rawBody, {
    headers: {
      "webhook-id": headers["webhook-id"],
      "webhook-signature": headers["webhook-signature"],
      "webhook-timestamp": headers["webhook-timestamp"]
    }
  });
}
