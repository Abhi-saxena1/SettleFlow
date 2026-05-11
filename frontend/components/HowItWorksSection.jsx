import { BadgeCheck, FilePlus2, Landmark, Send } from "lucide-react";

const steps = [
  {
    icon: FilePlus2,
    title: "Create",
    description: "Add invoice details, buyer and seller names, amount, and seller wallet."
  },
  {
    icon: Landmark,
    title: "Fund",
    description: "Buyer payment is collected and treasury escrow funding starts on-chain."
  },
  {
    icon: BadgeCheck,
    title: "Release",
    description: "Buyer approves completed work and releases escrow to the seller."
  },
  {
    icon: Send,
    title: "Withdraw",
    description: "Seller connects the assigned wallet and withdraws the settled USDC."
  }
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="container-shell py-14 sm:py-20">
      <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <p className="section-kicker">How it works</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">
            From invoice to settled payout.
          </h2>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {steps.map(({ icon: Icon, title, description }, index) => (
          <div key={title} className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <div className="flex items-center justify-between gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-mint text-leaf">
                <Icon size={21} />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-black/30">
                0{index + 1}
              </p>
            </div>
            <h3 className="mt-5 text-xl font-black text-ink">{title}</h3>
            <p className="mt-3 text-sm font-semibold leading-6 text-black/55">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
