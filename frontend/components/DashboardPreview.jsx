import Link from "next/link";

const previewInvoices = [
  ["INV-1001", "$12,500", "Pending", "Low"],
  ["INV-1002", "$48,000", "Funded", "Medium"],
  ["INV-1003", "$7,800", "Completed", "Low"]
];

export default function DashboardPreview() {
  return (
    <section className="container-shell py-20">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="section-kicker">Dashboard</p>
          <h2 className="mt-3 text-4xl font-black tracking-tight text-ink">Invoices, status, and risk in one view.</h2>
        </div>
        <Link href="/dashboard" className="button-secondary">Open Dashboard</Link>
      </div>
      <div className="animate-reveal overflow-hidden rounded-xl border border-black/10 bg-white shadow-md">
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
