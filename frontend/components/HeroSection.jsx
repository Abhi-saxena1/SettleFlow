import Link from "next/link";
import { ArrowUpRight, FilePlus2, Search, ShieldCheck, Sparkles, Zap } from "lucide-react";

export default function HeroSection() {
  return (
    <section className="container-shell relative overflow-hidden py-12 sm:py-16">
      <div className="pointer-events-none absolute inset-x-5 top-12 h-px bg-gradient-to-r from-transparent via-[#bed98a] to-transparent" />
      <div className="mx-auto max-w-4xl text-center">
        <div className="animate-reveal mx-auto mb-5 inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm font-semibold leading-tight text-ink shadow-sm sm:px-4">
          <Zap size={16} className="shrink-0 text-leaf" />
          <span className="sm:hidden">Smart-contract settlement</span>
          <span className="hidden sm:inline">Smart-contract settlement for modern SMEs</span>
        </div>
        <h1 className="hero-title animate-reveal text-5xl leading-[0.98] text-ink sm:text-6xl lg:text-7xl" style={{ animationDelay: "90ms" }}>
          Instant B2B payments,
          <span className="hero-highlight mx-auto mt-1 block w-fit px-2 sm:mx-2 sm:mt-0 sm:inline-block">
            settled in seconds.
          </span>
        </h1>
        <p className="animate-reveal mx-auto mt-6 max-w-2xl text-lg leading-8 text-black/65" style={{ animationDelay: "180ms" }}>
          Create invoices, lock funds in escrow, assess transaction risk, and release settlement in seconds using programmable payment flows.
        </p>
        <div className="animate-reveal mt-8 flex flex-col justify-center gap-3 sm:flex-row" style={{ animationDelay: "270ms" }}>
          <Link href="/dashboard#create" className="button-primary gap-2">
            <FilePlus2 size={18} />
            Create Invoice
          </Link>
          <Link href="/dashboard" className="button-secondary gap-2">
            Dashboard
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </div>

      <div className="animate-reveal relative mx-auto mt-12 max-w-[460px]" style={{ animationDelay: "260ms" }}>
        <div className="animate-slow-tilt pin-shell p-5 sm:p-7">
          <div className="paper-grid overflow-hidden rounded-sm border border-black/15 bg-white shadow-md">
            <div className="flex items-center justify-between border-b border-black/10 bg-white/75 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-black/70">
              <span className="text-xl normal-case tracking-tight text-ink">SettleFlow</span>
              <div className="hidden items-center gap-4 sm:flex">
                <span>Invoices</span>
                <span>Escrow</span>
                <span>Risk</span>
              </div>
              <Link href="/dashboard#create" className="rounded-full border border-black/15 bg-white px-3 py-1 text-[10px] normal-case tracking-normal text-ink">
                Create
              </Link>
            </div>

            <div className="px-7 pb-7 pt-8 text-center">
              <div className="mx-auto mb-3 inline-flex items-center gap-1 rounded-full bg-[#f7b8c7]/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-ink">
                <Sparkles size={12} />
                programmable payments
              </div>
              <h2 className="mx-auto max-w-sm text-4xl font-black leading-[0.95] tracking-tight text-ink sm:text-5xl">
                the operating system for B2B settlement
              </h2>
              <p className="mx-auto mt-4 max-w-xs text-sm font-semibold leading-6 text-black/60">
                AI risk scoring, escrow funding, and instant release flows in one clean workspace.
              </p>
              <div className="mt-5 flex justify-center">
                <Link href="/dashboard" className="rounded-full border border-black/15 bg-white px-4 py-2 text-xs font-black shadow-sm hover:-translate-y-0.5">
                  Open Dashboard
                </Link>
              </div>
            </div>

            <div className="border-y border-black/10 bg-[#c8dc94] py-2 text-center text-[10px] font-black uppercase tracking-[0.22em] text-black/55">
              invoice escrow risk release invoice escrow risk release
            </div>

            <div className="px-7 py-7">
              <p className="text-center text-xs font-black uppercase tracking-[0.18em] text-leaf">Live payment flow</p>
              <h3 className="mx-auto mt-2 max-w-xs text-center text-xl font-black leading-tight text-ink">
                For teams that need payment confidence before goods move.
              </h3>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  ["Create", "INV-1004", "#f7b8c7"],
                  ["Fund", "$28k locked", "#bde7ff"],
                  ["Release", "3.0 sec", "#c8dc94"]
                ].map(([label, value, color]) => (
                  <div key={label} className="rounded-lg border border-black/10 bg-white p-3 text-center shadow-sm" style={{ backgroundColor: color }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/45">{label}</p>
                    <p className="mt-2 text-sm font-black text-ink">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid grid-cols-[0.95fr_1.05fr] gap-4">
                <div>
                  <p className="text-2xl font-black leading-none text-ink">join the instant settlement stack</p>
                  <p className="mt-3 text-xs leading-5 text-black/55">
                    Replace delayed bank rails with programmable escrow and risk-aware releases.
                  </p>
                </div>
                <div className="relative min-h-36 overflow-hidden rounded-lg bg-ink p-4 text-white">
                  <div className="animate-scan-line pointer-events-none absolute left-0 right-0 top-5 h-px bg-gradient-to-r from-transparent via-leaf to-transparent" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/55">Escrow vault</span>
                    <ShieldCheck className="text-leaf" size={22} />
                  </div>
                  <p className="mt-4 text-3xl font-black">$248k</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="progress-fill h-full w-[82%] rounded-full bg-leaf" />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-white/60">82% settlement velocity</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute -bottom-5 left-4 right-4 flex justify-center gap-3">
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-2xl bg-white/90 px-5 py-3 text-sm font-black text-ink shadow-md backdrop-blur hover:-translate-y-0.5">
            <ArrowUpRight size={17} />
            Visit app
          </Link>
          <a href="#risk" className="inline-flex items-center gap-2 rounded-2xl bg-white/90 px-5 py-3 text-sm font-black text-ink shadow-md backdrop-blur hover:-translate-y-0.5">
            <Search size={17} />
            Test risk
          </a>
        </div>

        <div className="animate-reveal absolute -left-4 top-28 hidden rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-md sm:block" style={{ animationDelay: "650ms" }}>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-black/45">Risk</p>
          <p className="mt-1 text-2xl font-black text-leaf">Low 18</p>
        </div>
        <div className="animate-reveal absolute -right-5 top-56 hidden rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-md sm:block" style={{ animationDelay: "780ms" }}>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-black/45">Release</p>
          <p className="mt-1 text-2xl font-black text-ink">3.0s</p>
        </div>
      </div>
    </section>
  );
}
