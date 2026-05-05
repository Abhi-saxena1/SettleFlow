"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import AuthModal from "../../components/AuthModal";
import InvoiceForm from "../../components/InvoiceForm";
import InvoiceTable from "../../components/InvoiceTable";
import Navbar from "../../components/Navbar";
import {
  createDodoCheckout,
  deleteInvoice,
  fundStablecoinEscrow,
  getAnalyticsSummary,
  getStablecoinConfig,
  getInvoices,
  releaseStablecoinEscrow,
  syncDodoPayment
} from "../../lib/api";
import { AUTH_CHANGED_EVENT, getStoredSession, saveSession } from "../../lib/authSession";

export default function DashboardPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [analytics, setAnalytics] = useState({
    totalSettled: 0,
    avgSettlementTimeHours: 0,
    totalInvoices: 0
  });

  const isAuthenticated = Boolean(session?.token);

  async function loadInvoices() {
    setError("");
    setLoading(true);
    try {
      const [data, summary] = await Promise.all([getInvoices(), getAnalyticsSummary()]);
      setInvoices(data);
      setAnalytics(summary);
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("login")) {
        setInvoices([]);
        setAnalytics({ totalSettled: 0, avgSettlementTimeHours: 0, totalInvoices: 0 });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const storedSession = getStoredSession();
    setSession(storedSession);

    function handleAuthChanged(event) {
      setSession(event.detail || getStoredSession());
    }

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener("storage", handleAuthChanged);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener("storage", handleAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (session?.token) {
      loadInvoices();
      return;
    }

    setInvoices([]);
    setAnalytics({ totalSettled: 0, avgSettlementTimeHours: 0, totalInvoices: 0 });
    setLoading(false);
  }, [session?.token]);

  function promptLogin() {
    setError("Please log in before creating invoices or moving funds.");
    setAuthMode("login");
  }

  function requireLogin() {
    if (isAuthenticated) {
      return true;
    }

    promptLogin();
    return false;
  }

  function handleAuthSuccess(result) {
    setSession(saveSession(result));
    setAuthMode(null);
    setError("");
  }

  async function runAction(id, action) {
    if (!requireLogin()) {
      return;
    }

    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const updated = await action(id);
      setInvoices((current) => current.map((invoice) => (invoice.id === id ? updated : invoice)));
      const summary = await getAnalyticsSummary();
      setAnalytics(summary);
      setNotice(`${updated.id} updated to ${updated.status}.`);
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("invoice not found")) {
        setInvoices((current) => current.filter((invoice) => invoice.id !== id));
        const summary = await getAnalyticsSummary().catch(() => null);
        if (summary) {
          setAnalytics(summary);
        }
      }
    } finally {
      setBusyId(null);
    }
  }

  async function removeInvoice(id) {
    if (!requireLogin()) {
      return;
    }

    const confirmed = window.confirm("Delete this invoice from your dashboard?");
    if (!confirmed) {
      return;
    }

    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await deleteInvoice(id);
      setInvoices((current) => current.filter((invoice) => invoice.id !== id));
      const summary = await getAnalyticsSummary();
      setAnalytics(summary);
      setNotice("Invoice deleted.");
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("invoice not found")) {
        setInvoices((current) => current.filter((invoice) => invoice.id !== id));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function startDodoCheckout(id) {
    if (!requireLogin()) {
      return;
    }

    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const result = await createDodoCheckout(id);
      setInvoices((current) => current.map((invoice) => (invoice.id === id ? result.invoice : invoice)));
      setNotice(`Dodo checkout created for ${Number(result.checkout?.intendedAmount || 0).toLocaleString()} USDC.`);

      if (result.checkout?.checkoutUrl) {
        window.open(result.checkout.checkoutUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      if (err.message.toLowerCase().includes("invoice not found")) {
        setInvoices((current) => current.filter((invoice) => invoice.id !== id));
        setError("That invoice no longer exists, so I removed the stale row from your dashboard.");
        return;
      }

      const needsDynamicPricing = err.message.toLowerCase().includes("pay what you want");
      setError(needsDynamicPricing
        ? err.message
        : `${err.message} Create backend/.env from backend/.env.example, add your Dodo API key and product ID, then restart the backend.`
      );
    } finally {
      setBusyId(null);
    }
  }

  function getSolanaProvider() {
    return window.phantom?.solana || window.solana || window.solflare || window.backpack?.solana || null;
  }

  function formatWalletError(error) {
    if (error?.message) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "USDC transfer failed. Check that your wallet is on Solana Devnet and has devnet SOL plus devnet USDC.";
  }

  async function startStablecoinFunding(invoice, paymentStage = "full") {
    if (!requireLogin()) {
      return;
    }

    setBusyId(invoice.id);
    setError("");
    setNotice("");

    try {
      const provider = getSolanaProvider();
      if (!provider) {
        throw new Error("No Solana wallet detected. Install or enable Phantom/Solflare and connect it in this browser.");
      }

      const config = await getStablecoinConfig();
      if (!config.configured) {
        throw new Error("Solana USDC is not configured. Add STABLECOIN_MINT_ADDRESS and STABLECOIN_ESCROW_WALLET to backend/.env.");
      }

      const connection = new Connection(config.rpcUrl, "confirmed");
      const connectResponse = await provider.connect();
      const buyerPublicKey = new PublicKey(connectResponse.publicKey.toString());
      const mint = new PublicKey(config.mint);
      const escrowOwner = new PublicKey(config.escrowWallet);
      const buyerTokenAccount = await getAssociatedTokenAddress(mint, buyerPublicKey);
      const escrowTokenAccount = await getAssociatedTokenAddress(mint, escrowOwner);
      const stageAmount = paymentStage === "upfront"
        ? Number(invoice.upfront_amount)
        : paymentStage === "remaining"
          ? Number(invoice.remaining_amount)
          : Number(invoice.amount);
      const amount = BigInt(Math.round(stageAmount * 10 ** Number(config.decimals)));
      const transaction = new Transaction();
      const buyerTokenAccountInfo = await connection.getParsedAccountInfo(buyerTokenAccount);
      const solBalance = await connection.getBalance(buyerPublicKey);

      if (solBalance <= 0) {
        throw new Error("Your wallet has no devnet SOL for transaction fees. Switch Phantom to Devnet and request an airdrop.");
      }

      if (!buyerTokenAccountInfo.value) {
        throw new Error(`Your wallet does not have a devnet ${config.symbol} token account for mint ${config.mint}. Get devnet USDC first.`);
      }

      const parsedTokenAccount = buyerTokenAccountInfo.value.data?.parsed?.info;
      const tokenAmount = Number(parsedTokenAccount?.tokenAmount?.uiAmountString || 0);

      if (tokenAmount < stageAmount) {
        throw new Error(`Insufficient devnet ${config.symbol}. Need ${stageAmount}, wallet has ${tokenAmount}.`);
      }

      const escrowAccountInfo = await connection.getAccountInfo(escrowTokenAccount);

      if (!escrowAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            buyerPublicKey,
            escrowTokenAccount,
            escrowOwner,
            mint
          )
        );
      }

      transaction.add(
        createTransferCheckedInstruction(
          buyerTokenAccount,
          mint,
          escrowTokenAccount,
          buyerPublicKey,
          amount,
          Number(config.decimals)
        )
      );

      transaction.feePayer = buyerPublicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const simulation = await connection.simulateTransaction(transaction);
      if (simulation.value.err) {
        throw new Error(`Solana simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      const { signature } = provider.signAndSendTransaction
        ? await provider.signAndSendTransaction(transaction)
        : { signature: await connection.sendRawTransaction((await provider.signTransaction(transaction)).serialize()) };

      await connection.confirmTransaction(signature, "confirmed");
      const updated = await fundStablecoinEscrow(invoice.id, buyerPublicKey.toBase58(), signature, paymentStage);
      setInvoices((current) => current.map((item) => (item.id === invoice.id ? updated : item)));
      const summary = await getAnalyticsSummary();
      setAnalytics(summary);
      setNotice(`${stageAmount.toLocaleString()} USDC locked in escrow. Tx: ${signature.slice(0, 8)}...`);
    } catch (err) {
      setError(formatWalletError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function startStablecoinRelease(id) {
    if (!requireLogin()) {
      return;
    }

    setError("");

    try {
      const provider = getSolanaProvider();
      let defaultWallet = "";

      if (provider) {
        const response = await provider.connect({ onlyIfTrusted: true }).catch(() => null);
        defaultWallet = response?.publicKey?.toString() || provider.publicKey?.toString() || "";
      }

      const sellerWallet = window.prompt(
        "Enter the SELLER Solana wallet address to receive USDC. Do not use the buyer wallet unless you are only testing with one account:",
        defaultWallet
      )?.trim();

      if (!sellerWallet) {
        return;
      }

      new PublicKey(sellerWallet);
      const invoice = invoices.find((item) => item.id === id);
      if (invoice?.stablecoin?.buyerWallet === sellerWallet) {
        const useSameWallet = window.confirm(
          "This seller address is the same as the buyer wallet that funded escrow. Continue anyway?"
        );

        if (!useSameWallet) {
          return;
        }
      }
      await runAction(id, (invoiceId) => releaseStablecoinEscrow(invoiceId, sellerWallet));
    } catch (err) {
      setError(
        err.message?.includes("Non-base58")
          ? "Enter a valid Solana wallet address, not a MetaMask/EVM address or text from another page."
          : formatWalletError(err)
      );
    }
  }

  return (
    <>
      <Navbar />
      <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSuccess={handleAuthSuccess} />
      <main className="container-shell py-10">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-black/55 hover:text-ink">
          <ArrowLeft size={16} />
          Back to home
        </Link>
        <div className="mb-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="section-kicker">Operations</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-ink sm:text-5xl">Settlement dashboard</h1>
            <p className="mt-4 max-w-2xl leading-7 text-black/60">
              Create invoices, collect funds through real Dodo Payments checkout sessions, release escrow, and review AI risk signals.
            </p>
            <p className="mt-3 inline-flex rounded-full border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm font-black text-yellow-800">
              ⚠️ Running on Devnet (Test Mode)
            </p>
          </div>
          <button onClick={isAuthenticated ? loadInvoices : promptLogin} className="button-secondary gap-2">
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <p className="section-kicker">Total Settled</p>
            <p className="mt-2 text-3xl font-black text-ink">
              {Number(analytics.totalSettled || 0).toLocaleString()} USDC
            </p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <p className="section-kicker">Avg Settlement Time</p>
            <p className="mt-2 text-3xl font-black text-ink">
              {Number(analytics.avgSettlementTimeHours || 0).toLocaleString()} hours
            </p>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-md">
            <p className="section-kicker">Total Invoices</p>
            <p className="mt-2 text-3xl font-black text-ink">
              {Number(analytics.totalInvoices || 0).toLocaleString()}
            </p>
          </div>
        </section>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <InvoiceForm
            disabled={!isAuthenticated}
            onLoginRequired={promptLogin}
            onError={setError}
            onCreated={(invoice) => {
              setInvoices((current) => [invoice, ...current]);
              setAnalytics((current) => ({ ...current, totalInvoices: current.totalInvoices + 1 }));
            }}
          />
          <section className="min-w-0">
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {error}
              </div>
            )}
            {notice && (
              <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
                {notice}
              </div>
            )}
            {!isAuthenticated ? (
              <div className="grid min-h-80 place-items-center rounded-xl border border-black/10 bg-white p-8 text-center shadow-md">
                <div>
                  <p className="section-kicker">Login required</p>
                  <h2 className="mt-2 text-2xl font-black text-ink">Your dashboard is private</h2>
                  <p className="mt-3 max-w-md text-black/55">
                    Log in or sign up to create invoices, fund escrow, release payments, and see only your own transactions.
                  </p>
                  <button onClick={() => setAuthMode("login")} className="button-primary mt-6">
                    Login
                  </button>
                </div>
              </div>
            ) : loading ? (
              <div className="grid min-h-80 place-items-center rounded-xl border border-black/10 bg-white shadow-md">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-leaf border-t-transparent" />
              </div>
            ) : (
              <InvoiceTable
                invoices={invoices}
                onDelete={removeInvoice}
                onDodoCheckout={startDodoCheckout}
                onSyncPayment={(id) => runAction(id, syncDodoPayment)}
                onFundStablecoin={startStablecoinFunding}
                onReleaseStablecoin={startStablecoinRelease}
                busyId={busyId}
              />
            )}
          </section>
        </div>
      </main>
    </>
  );
}
