"use client";

import Link from "next/link";
import AuthButtons from "./AuthButtons";
import WalletConnectButton from "./WalletConnectButton";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-[#f8fbef]/85 backdrop-blur-xl">
      <nav className="container-shell flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-black text-white">
            SF
          </span>
          <span className="text-lg font-black tracking-tight">SettleFlow</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm font-medium text-black/65 md:flex">
          <a href="/#features" className="hover:text-ink">Features</a>
          <a href="/#risk" className="hover:text-ink">AI Risk</a>
          <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-black text-yellow-800 lg:inline-flex">
            ⚠️ Devnet Test Mode
          </span>
          <AuthButtons />
          <WalletConnectButton />
        </div>
      </nav>
    </header>
  );
}
