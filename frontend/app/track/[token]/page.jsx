import PublicInvoiceTracker from "../../../components/PublicInvoiceTracker";

export default function TrackInvoicePage({ params }) {
  return <PublicInvoiceTracker token={params.token} />;
}
