import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress
} from "@solana/spl-token";

export class StablecoinConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StablecoinConfigurationError";
    this.statusCode = 503;
  }
}

export function stablecoinConfig() {
  const escrowSigner = escrowKeypair();

  return {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    chain: process.env.STABLECOIN_CHAIN || "solana-devnet",
    symbol: process.env.STABLECOIN_SYMBOL || "USDC",
    mint: process.env.STABLECOIN_MINT_ADDRESS || "",
    escrowWallet: process.env.STABLECOIN_ESCROW_WALLET || escrowSigner?.publicKey.toBase58() || "",
    decimals: Number(process.env.STABLECOIN_DECIMALS || 6)
  };
}

export function escrowKeypair() {
  if (!process.env.STABLECOIN_ESCROW_SECRET_KEY) {
    return null;
  }

  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.STABLECOIN_ESCROW_SECRET_KEY)));
}

export function requireStablecoinConfig() {
  const config = stablecoinConfig();

  if (!config.mint || !config.escrowWallet) {
    throw new StablecoinConfigurationError(
      "Solana USDC is not configured. Add STABLECOIN_MINT_ADDRESS and STABLECOIN_ESCROW_WALLET to backend/.env."
    );
  }

  return config;
}

export async function verifyStablecoinTransfer({ signature, expectedBuyer, expectedAmount }) {
  const config = requireStablecoinConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  if (!tx) {
    throw new Error("Transaction was not found or is not confirmed yet.");
  }

  if (tx.meta?.err) {
    throw new Error("Transaction failed on-chain.");
  }

  const expectedMint = new PublicKey(config.mint).toBase58();
  const expectedOwner = new PublicKey(expectedBuyer).toBase58();
  const expectedDestinationOwner = new PublicKey(config.escrowWallet).toBase58();
  const expectedUiAmount = Number(expectedAmount);

  let matchedDestinationTokenAccount = "";
  const transfer = tx.transaction.message.instructions.find((instruction) => {
    if (!("parsed" in instruction) || instruction.program !== "spl-token") {
      return false;
    }

    const parsed = instruction.parsed;
    const info = parsed?.info || {};
    const tokenAmount = info.tokenAmount || {};
    const uiAmount = Number(tokenAmount.uiAmountString || info.amount || 0);
    const destination = info.destination;
    const destinationBalance = tx.meta?.postTokenBalances?.find((balance) => {
      const accountKey = tx.transaction.message.accountKeys[balance.accountIndex]?.pubkey?.toBase58();
      return accountKey === destination;
    });

    const matched = (
      ["transfer", "transferChecked"].includes(parsed?.type) &&
      info.mint === expectedMint &&
      info.authority === expectedOwner &&
      destinationBalance?.owner === expectedDestinationOwner &&
      Math.abs(uiAmount - expectedUiAmount) < 0.000001
    );

    if (matched) {
      matchedDestinationTokenAccount = destination;
    }

    return matched;
  });

  if (!transfer) {
    throw new Error("Transaction does not match the expected USDC escrow transfer.");
  }

  return {
    signature,
    slot: tx.slot,
    chain: config.chain,
    token: config.symbol,
    mint: expectedMint,
    escrowWallet: expectedDestinationOwner,
    escrowTokenAccount: matchedDestinationTokenAccount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  };
}

export async function escrowTokenBalance() {
  const config = requireStablecoinConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(config.mint);
  const escrowOwner = new PublicKey(config.escrowWallet);
  const escrowAta = await getAssociatedTokenAddress(mint, escrowOwner);

  try {
    const balance = await connection.getTokenAccountBalance(escrowAta);
    return {
      tokenAccount: escrowAta.toBase58(),
      uiAmount: Number(balance.value.uiAmountString || 0)
    };
  } catch {
    return {
      tokenAccount: escrowAta.toBase58(),
      uiAmount: 0
    };
  }
}

export async function releaseStablecoinTransfer({ sellerWallet, amount }) {
  const config = requireStablecoinConfig();
  const signer = escrowKeypair();

  if (!signer) {
    throw new StablecoinConfigurationError(
      "USDC release requires STABLECOIN_ESCROW_SECRET_KEY in backend/.env so the backend can sign from the escrow wallet."
    );
  }

  if (signer.publicKey.toBase58() !== config.escrowWallet) {
    throw new StablecoinConfigurationError("STABLECOIN_ESCROW_SECRET_KEY does not match STABLECOIN_ESCROW_WALLET.");
  }

  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(config.mint);
  const seller = new PublicKey(sellerWallet);
  const escrowSolBalance = await connection.getBalance(signer.publicKey);

  if (escrowSolBalance < 5000) {
    throw new Error(
      `Escrow wallet needs devnet SOL for release fees. Send a small amount of devnet SOL to ${signer.publicKey.toBase58()}.`
    );
  }

  const sourceAta = await getAssociatedTokenAddress(mint, signer.publicKey);
  const destinationAta = await getAssociatedTokenAddress(mint, seller);
  const sourceBalance = await connection.getTokenAccountBalance(sourceAta);

  if (Number(sourceBalance.value.uiAmountString || 0) < Number(amount)) {
    throw new Error(
      `Escrow token account has ${sourceBalance.value.uiAmountString} USDC, but this invoice requires ${amount} USDC.`
    );
  }

  const transaction = new Transaction();
  const destinationInfo = await connection.getAccountInfo(destinationAta);

  if (!destinationInfo) {
    transaction.add(createAssociatedTokenAccountInstruction(signer.publicKey, destinationAta, seller, mint));
  }

  transaction.add(
    createTransferCheckedInstruction(
      sourceAta,
      mint,
      destinationAta,
      signer.publicKey,
      BigInt(Math.round(Number(amount) * 10 ** config.decimals)),
      config.decimals
    )
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: "confirmed"
  });

  return {
    signature,
    chain: config.chain,
    token: config.symbol,
    mint: config.mint,
    sellerWallet,
    escrowWallet: config.escrowWallet,
    sourceTokenAccount: sourceAta.toBase58(),
    destinationTokenAccount: destinationAta.toBase58(),
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  };
}
