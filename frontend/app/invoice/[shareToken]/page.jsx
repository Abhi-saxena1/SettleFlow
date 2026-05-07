import PublicInvoiceTracker from "../../../components/PublicInvoiceTracker";

export default function PublicInvoicePage({ params }) {
  return <PublicInvoiceTracker token={params.shareToken} />;
}
