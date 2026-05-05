import { Activity, BadgeCheck, Brain, FilePlus2, Landmark } from "lucide-react";
import FeatureCard from "./FeatureCard";

const features = [
  {
    icon: FilePlus2,
    title: "Create Invoice",
    description: "Generate payable invoices with buyer, seller, amount, and settlement state."
  },
  {
    icon: Landmark,
    title: "Fund Escrow",
    description: "Simulate buyer funding into a smart-contract escrow vault before delivery."
  },
  {
    icon: BadgeCheck,
    title: "Release Payment",
    description: "Confirm delivery and release locked funds instantly to the seller."
  },
  {
    icon: Brain,
    title: "AI Risk Analysis",
    description: "Score every transaction with amount and buyer history signals."
  },
  {
    icon: Activity,
    title: "Transaction Tracking",
    description: "Track pending, funded, and completed invoices in one operational dashboard."
  }
];

export default function FeaturesSection() {
  return (
    <section id="features" className="container-shell py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="section-kicker">Platform</p>
        <h2 className="mt-3 text-4xl font-black leading-tight tracking-tight text-ink sm:text-5xl">
          Payment operations built around settlement speed.
        </h2>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => (
          <FeatureCard key={feature.title} {...feature} index={index} />
        ))}
      </div>
    </section>
  );
}
