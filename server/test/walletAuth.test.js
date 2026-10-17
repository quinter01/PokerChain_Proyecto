import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { createWalletChallenge, verifyWalletSignature } from "../src/walletAuth.js";

test("accepts a signature from the wallet named in its challenge", async () => {
  const wallet = Wallet.createRandom();
  const challenge = createWalletChallenge(wallet.address, 1000);
  const signature = await wallet.signMessage(challenge.message);

  assert.equal(verifyWalletSignature(challenge, signature, 1001), true);
});

test("rejects another wallet, an expired challenge, and a malformed signature", async () => {
  const wallet = Wallet.createRandom();
  const otherWallet = Wallet.createRandom();
  const challenge = createWalletChallenge(wallet.address, 1000);
  const otherSignature = await otherWallet.signMessage(challenge.message);
  const validSignature = await wallet.signMessage(challenge.message);

  assert.equal(verifyWalletSignature(challenge, otherSignature, 1001), false);
  assert.equal(verifyWalletSignature(challenge, validSignature, challenge.expiresAt + 1), false);
  assert.equal(verifyWalletSignature(challenge, "not-a-signature", 1001), false);
});
