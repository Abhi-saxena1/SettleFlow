import Link from "next/link";

const previewInvoices = [
  ["INV-1001", "$12,500", "Pending", "Low"],
  ["INV-1002", "$48,000", "Funded", "Medium"],
  ["INV-1003", "$7,800", "Completed", "Low"]
];

export default function DashboardPreview() {
  return (
    <section className="container-shell overflow-hidden py-14 sm:py-20">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <p className="section-kicker">Dashboard</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">Invoices, status, and risk in one view.</h2>
        </div>
        <Link href="/dashboard" className="button-secondary w-full sm:w-auto">Open Dashboard</Link>
      </div>
      <div className="animate-reveal grid gap-3 sm:hidden">
        {previewInvoices.map(([id, amount, status, risk], index) => (
          <div
            key={id}
            className="rounded-xl border border-black/10 bg-white p-5 shadow-md"
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-black/35">Invoice</p>
                <p className="mt-1 break-words text-xl font-black text-ink">{id}</p>
              </div>
              <p className="shrink-0 text-xl font-black text-ink">{amount}</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-sage p-3">
                <p className="text-xs font-bold text-black/45">Status</p>
                <p className="mt-1 font-black text-ink">{status}</p>
              </div>
              <div className="rounded-xl bg-mint p-3">
                <p className="text-xs font-bold text-black/45">Risk</p>
                <p className="mt-1 font-black text-ink">{risk}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="animate-reveal hidden overflow-hidden rounded-xl border border-black/10 bg-white shadow-md sm:block">
        <table className="w-full text-left">
          <thead className="bg-sage text-sm text-black/55">
            <tr>
              <th className="px-5 py-4">ID</th>
              <th className="px-5 py-4">Amount</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {previewInvoices.map(([id, amount, status, risk], index) => (
              <tr key={id} className="animate-reveal hover:bg-sage/60" style={{ animationDelay: `${index * 110}ms` }}>
                <td className="px-5 py-4 font-black">{id}</td>
                <td className="px-5 py-4">{amount}</td>
                <td className="px-5 py-4">{status}</td>
                <td className="px-5 py-4">{risk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
