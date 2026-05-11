import { Mail } from "lucide-react";

export default function AboutSection() {
  return (
    <section id="about" className="container-shell pb-20">
      <div className="border-t border-black/10 pt-10">
        <div className="grid gap-6 md:grid-cols-[0.8fr_1.2fr] md:items-start">
          <div>
            <p className="section-kicker">About</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">
              Built for faster, clearer B2B settlement.
            </h2>
          </div>
          <div className="space-y-5 text-black/65">
            <p className="max-w-3xl leading-7">
              SettleFlow helps teams create invoices, secure funds in escrow, review risk signals, and release payments with confidence from one simple workspace.
            </p>
            <a
              href="mailto:settleflowx@gmail.com"
              className="inline-flex items-center gap-2 text-sm font-black text-ink hover:text-leaf"
            >
              <Mail size={18} />
              settleflowx@gmail.com
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
