"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Loader2, Wallet } from "lucide-react";

function getSolanaProvider() {
  if (typeof window === "undefined") {
    return null;
  }

  const providers = [
    window.phantom?.solana,
    window.solana,
    window.solflare,
    window.backpack?.solana
  ].filter(Boolean);

  return providers.find((item) => item.isPhantom) || providers[0] || null;
}

function getEthereumProvider() {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.ethereum?.providers?.length) {
    return window.ethereum.providers.find((item) => item.isMetaMask) || window.ethereum.providers[0];
  }

  return window.ethereum || null;
}

function shortenAddress(address) {
  if (!address) {
    return "";
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function WalletConnectButton() {
  const [solanaProvider, setSolanaProvider] = useState(null);
  const [ethereumProvider, setEthereumProvider] = useState(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletType, setWalletType] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const walletName = useMemo(() => {
    if (walletType === "ethereum") {
      return ethereumProvider?.isMetaMask ? "MetaMask" : "EVM Wallet";
    }

    if (!solanaProvider) {
      return "Solana Wallet";
    }

    if (solanaProvider.isPhantom) {
      return "Phantom";
    }

    if (solanaProvider.isSolflare) {
      return "Solflare";
    }

    if (solanaProvider.isBackpack) {
      return "Backpack";
    }

    return "Solana Wallet";
  }, [ethereumProvider, solanaProvider, walletType]);

  useEffect(() => {
    let activeProvider = null;

    function syncProvider() {
      const detectedProvider = getSolanaProvider();
      activeProvider = detectedProvider;
      setSolanaProvider(detectedProvider);

      if (detectedProvider?.isConnected && detectedProvider.publicKey) {
        setWalletAddress(detectedProvider.publicKey.toString());
        setWalletType("solana");
      }

      detectedProvider?.on?.("connect", handleConnect);
      detectedProvider?.on?.("disconnect", handleDisconnect);
    }

    function handleConnect(nextPublicKey) {
      if (nextPublicKey) {
        setWalletAddress(nextPublicKey.toString());
        setWalletType("solana");
      }
      setError("");
    }

    function handleDisconnect() {
      setWalletAddress("");
      setWalletType("");
    }

    setEthereumProvider(getEthereumProvider());
    syncProvider();
    window.addEventListener("phantom#initialized", syncProvider);
    window.addEventListener("solana#initialized", syncProvider);
    const retryTimer = window.setTimeout(syncProvider, 900);

    return () => {
      window.clearTimeout(retryTimer);
      window.removeEventListener("phantom#initialized", syncProvider);
      window.removeEventListener("solana#initialized", syncProvider);
      activeProvider?.off?.("connect", handleConnect);
      activeProvider?.off?.("disconnect", handleDisconnect);
    };
  }, []);

  async function connectSolanaWallet() {
    const detectedProvider = solanaProvider || getSolanaProvider();
    setSolanaProvider(detectedProvider);
    setError("");
    setMenuOpen(false);

    if (!detectedProvider) {
      setError("No Solana wallet was detected in this browser tab.");
      return;
    }

    setConnecting(true);
    try {
      const response = await detectedProvider.connect();
      setWalletAddress(response.publicKey.toString());
      setWalletType("solana");
    } catch (err) {
      setError(err?.message || "Wallet connection was cancelled.");
    } finally {
      setConnecting(false);
    }
  }

  async function connectMetaMask() {
    const detectedProvider = ethereumProvider || getEthereumProvider();
    setEthereumProvider(detectedProvider);
    setError("");
    setMenuOpen(false);

    if (!detectedProvider) {
      setError("No MetaMask or EVM wallet was detected in this browser tab.");
      return;
    }

    setConnecting(true);
    try {
      const accounts = await detectedProvider.request({ method: "eth_requestAccounts" });
      setWalletAddress(accounts[0]);
      setWalletType("ethereum");
    } catch (err) {
      setError(err?.message || "MetaMask connection was cancelled.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWallet() {
    setError("");

    try {
      if (walletType === "solana") {
        await solanaProvider?.disconnect?.();
      }
    } finally {
      setWalletAddress("");
      setWalletType("");
    }
  }

  if (!solanaProvider && !ethereumProvider && error) {
    return (
      <div className="group relative">
        <a
          href="https://phantom.app/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:-translate-y-0.5 hover:shadow-md"
          title={error}
        >
          <ExternalLink size={17} />
          Open Wallet Site
        </a>
        <div className="pointer-events-none absolute right-0 top-12 hidden w-72 rounded-xl border border-black/10 bg-white p-3 text-xs font-semibold leading-5 text-black/60 shadow-md group-hover:block">
          <div className="mb-1 flex items-center gap-2 font-black text-ink">
            <AlertCircle size={15} className="text-leaf" />
            Wallet not visible here
          </div>
          Your wallet may be installed in your main browser, but not injected into this in-app browser tab. Open the app in that browser or enable the extension here.
        </div>
      </div>
    );
  }

  if (walletAddress) {
    return (
      <button
        onClick={disconnectWallet}
        className="inline-flex max-w-[12rem] items-center gap-2 truncate rounded-full border border-leaf/25 bg-mint px-3 py-2 text-sm font-semibold text-ink shadow-sm hover:-translate-y-0.5 hover:shadow-md sm:max-w-none sm:px-4"
        title={`Connected to ${walletName}: ${walletAddress}`}
      >
        <CheckCircle2 size={17} className="text-leaf" />
        <span className="truncate">{walletName} {shortenAddress(walletAddress)}</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((current) => !current)}
        className="inline-flex max-w-[12rem] items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:-translate-y-0.5 hover:shadow-md sm:max-w-none sm:px-4"
        disabled={connecting}
        title={error || "Choose a wallet"}
      >
        {connecting ? <Loader2 size={17} className="animate-spin" /> : <Wallet size={17} />}
        <span className="truncate">{connecting ? "Connecting" : "Connect Wallet"}</span>
        <ChevronDown size={15} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-12 z-40 w-[min(16rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white p-2 shadow-md">
          <button
            onClick={connectMetaMask}
            className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-bold hover:bg-sage"
          >
            <span>MetaMask</span>
            <span className="text-xs font-semibold text-black/45">EVM</span>
          </button>
          <button
            onClick={connectSolanaWallet}
            className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-bold hover:bg-sage"
          >
            <span>Phantom / Solana</span>
            <span className="text-xs font-semibold text-black/45">SOL</span>
          </button>
          {error && (
            <div className="mt-2 flex gap-2 rounded-xl bg-yellow-50 p-3 text-xs font-semibold leading-5 text-yellow-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
