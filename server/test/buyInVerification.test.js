import test from "node:test";
import assert from "node:assert/strict";
import { Interface, Wallet } from "ethers";
import { verifyBuyInTransaction, verifyRefundTransaction } from "../src/buyInVerification.js";

const contractAddress = "0x1000000000000000000000000000000000000001";
const contractInterface = new Interface([
  "function joinTable(uint8 targetPlayerCount) payable",
  "event PlayerJoined(address indexed player, uint256 amount)"
]);
const buyIn = 10_000_000_000_000_000n;

function makePayment(wallet = Wallet.createRandom(), playerCount = 2) {
  const data = contractInterface.encodeFunctionData("joinTable", [playerCount]);
  const event = contractInterface.encodeEventLog(
    contractInterface.getEvent("PlayerJoined"),
    [wallet.address, buyIn]
  );
  return {
    wallet,
    transaction: {
      to: contractAddress,
      from: wallet.address,
      value: buyIn,
      data
    },
    receipt: {
      status: 1,
      logs: [{ address: contractAddress, ...event }]
    }
  };
}

test("accepts the confirmed exact buy-in from the authenticated wallet", () => {
  const payment = makePayment();
  assert.doesNotThrow(() => verifyBuyInTransaction({
    ...payment,
    contractAddress,
    walletAddress: payment.wallet.address,
    playerCount: 2,
    buyIn
  }));
});

test("rejects payments from another wallet, wrong amount, player count, or contract", () => {
  const payment = makePayment();
  const base = {
    ...payment,
    contractAddress,
    walletAddress: payment.wallet.address,
    playerCount: 2,
    buyIn
  };

  assert.throws(() => verifyBuyInTransaction({
    ...base,
    walletAddress: Wallet.createRandom().address
  }), /no coincide/);
  assert.throws(() => verifyBuyInTransaction({
    ...base,
    transaction: { ...payment.transaction, value: buyIn - 1n }
  }), /monto pagado/);
  assert.throws(() => verifyBuyInTransaction({ ...base, playerCount: 3 }), /cantidad de jugadores/);
  assert.throws(() => verifyBuyInTransaction({
    ...base,
    contractAddress: Wallet.createRandom().address
  }), /no se envió al contrato/);
});

test("rejects unconfirmed receipts and receipts without the player's deposit event", () => {
  const payment = makePayment();
  const base = {
    ...payment,
    contractAddress,
    walletAddress: payment.wallet.address,
    playerCount: 2,
    buyIn
  };
  assert.throws(() => verifyBuyInTransaction({
    ...base,
    receipt: { ...payment.receipt, status: 0 }
  }), /no existe o no fue confirmada/);
  assert.throws(() => verifyBuyInTransaction({
    ...base,
    receipt: { status: 1, logs: [] }
  }), /no contiene el evento/);
});

test("accepts a confirmed refund call with the matching on-chain event", () => {
  const wallet = Wallet.createRandom();
  const refundInterface = new Interface([
    "function leaveTableAndRefund()",
    "event PlayerRefunded(address indexed player, uint256 amount)"
  ]);
  const event = refundInterface.encodeEventLog(
    refundInterface.getEvent("PlayerRefunded"),
    [wallet.address, buyIn]
  );
  const refund = {
    transaction: {
      to: contractAddress,
      from: wallet.address,
      value: 0n,
      data: refundInterface.encodeFunctionData("leaveTableAndRefund")
    },
    receipt: {
      status: 1,
      logs: [{ address: contractAddress, ...event }]
    }
  };

  assert.doesNotThrow(() => verifyRefundTransaction({
    ...refund,
    contractAddress,
    walletAddress: wallet.address,
    buyIn
  }));
});

test("rejects refunds from another wallet or without the matching refund event", () => {
  const wallet = Wallet.createRandom();
  const refundInterface = new Interface([
    "function leaveTableAndRefund()",
    "event PlayerRefunded(address indexed player, uint256 amount)"
  ]);
  const event = refundInterface.encodeEventLog(
    refundInterface.getEvent("PlayerRefunded"),
    [Wallet.createRandom().address, buyIn]
  );
  const refund = {
    transaction: {
      to: contractAddress,
      from: wallet.address,
      value: 0n,
      data: refundInterface.encodeFunctionData("leaveTableAndRefund")
    },
    receipt: {
      status: 1,
      logs: [{ address: contractAddress, ...event }]
    }
  };
  const base = { ...refund, contractAddress, walletAddress: wallet.address, buyIn };

  assert.throws(() => verifyRefundTransaction({
    ...base,
    walletAddress: Wallet.createRandom().address
  }), /wallet autenticada/);
  assert.throws(() => verifyRefundTransaction({
    ...base,
    transaction: { ...refund.transaction, data: "0x" }
  }), /no ejecutó el reembolso/);
  assert.throws(() => verifyRefundTransaction({
    ...base,
    receipt: { ...refund.receipt, logs: [] }
  }), /evento de reembolso válido/);
  assert.throws(() => verifyRefundTransaction({
    ...base,
    receipt: { ...refund.receipt, status: 0 }
  }), /no existe o no fue confirmada/);
});
