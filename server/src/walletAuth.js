import { randomUUID } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function createWalletChallenge(walletAddress, now = Date.now()) {
  const address = getAddress(walletAddress);
  const nonce = randomUUID();

  return {
    walletAddress: address,
    expiresAt: now + CHALLENGE_TTL_MS,
    message: [
      "PokerChain wallet authentication",
      `Address: ${address}`,
      `Nonce: ${nonce}`
    ].join("\n")
  };
}

export function verifyWalletSignature(challenge, signature, now = Date.now()) {
  if (!challenge || now > challenge.expiresAt || typeof signature !== "string") {
    return false;
  }

  try {
    return verifyMessage(challenge.message, signature).toLowerCase()
      === challenge.walletAddress.toLowerCase();
  } catch {
    return false;
  }
}
