import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function CTASection() {
  return (
    <section className="container-shell pb-20">
      <div className="animate-reveal shimmer-surface rounded-xl bg-mint p-8 shadow-md sm:p-12">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="section-kicker">Go live</p>
            <h2 className="mt-3 text-4xl font-black tracking-tight text-ink">Start settling payments instantly</h2>
            <p className="mt-4 max-w-2xl leading-7 text-black/60">
              Create your first invoice, simulate escrow funding, and release payment from the SettleFlow dashboard.
            </p>
          </div>
          <Link href="/dashboard#create" className="button-primary gap-2">
            Create Invoice
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
