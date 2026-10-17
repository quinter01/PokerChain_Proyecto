import { Interface, isAddress } from "ethers";
import { STARTING_STACK } from "./pokerGame.js";

export const MONAD_TESTNET_CHAIN_ID = 10143n;
export const CHIPS_PER_BUY_IN = STARTING_STACK;

const pokerTableInterface = new Interface([
  "function joinTable(uint8 targetPlayerCount) payable",
  "function leaveTableAndRefund()",
  "event PlayerJoined(address indexed player, uint256 amount)",
  "event PlayerRefunded(address indexed player, uint256 amount)"
]);

export function verifyBuyInTransaction({
  transaction,
  receipt,
  contractAddress,
  walletAddress,
  playerCount,
  buyIn
}) {
  if (!isAddress(contractAddress)) {
    throw new Error("El servidor no tiene una dirección válida del contrato de póker.");
  }
  if (!transaction || !receipt || receipt.status !== 1) {
    throw new Error("La transacción de buy-in no existe o no fue confirmada correctamente.");
  }
  if (transaction.to?.toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error("La transacción no se envió al contrato configurado para el buy-in.");
  }
  if (transaction.from?.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("La billetera que pagó no coincide con la billetera autenticada.");
  }
  if (transaction.value !== buyIn) {
    throw new Error("El monto pagado no coincide con el buy-in requerido de 0.01 MON.");
  }

  let call;
  try {
    call = pokerTableInterface.parseTransaction({
      data: transaction.data,
      value: transaction.value
    });
  } catch {
    throw new Error("La transacción no contiene una llamada válida para unirse al contrato.");
  }
  if (call?.name !== "joinTable" || Number(call.args.targetPlayerCount) !== playerCount) {
    throw new Error("La compra no corresponde a la cantidad de jugadores seleccionada.");
  }

  const matchingEvent = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) return false;
    try {
      const event = pokerTableInterface.parseLog(log);
      return event?.name === "PlayerJoined"
        && event.args.player.toLowerCase() === walletAddress.toLowerCase()
        && event.args.amount === buyIn;
    } catch {
      return false;
    }
  });
  if (!matchingEvent) {
    throw new Error("El recibo no contiene el evento de buy-in válido para esta billetera.");
  }
}

export function verifyRefundTransaction({ transaction, receipt, contractAddress, walletAddress, buyIn }) {
  if (!transaction || !receipt || receipt.status !== 1) {
    throw new Error("La transacción de reembolso no existe o no fue confirmada correctamente.");
  }
  if (!isAddress(contractAddress) || !isAddress(walletAddress)) {
    throw new Error("La dirección del contrato o de la wallet no es válida.");
  }
  if (transaction.to?.toLowerCase() !== contractAddress.toLowerCase()
    || transaction.from?.toLowerCase() !== walletAddress.toLowerCase()
    || transaction.value !== 0n) {
    throw new Error("La transacción de reembolso no corresponde al contrato o a la wallet autenticada.");
  }
  if (transaction.hash && receipt.hash && transaction.hash.toLowerCase() !== receipt.hash.toLowerCase()) {
    throw new Error("El recibo no corresponde a la transacción de reembolso enviada.");
  }
  let call;
  try {
    call = pokerTableInterface.parseTransaction({
      data: transaction.data,
      value: transaction.value
    });
  } catch {
    throw new Error("La transacción no contiene una llamada válida para reembolsar el buy-in.");
  }
  if (call?.name !== "leaveTableAndRefund") {
    throw new Error("La transacción no ejecutó el reembolso del buy-in.");
  }
  const refunded = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) return false;
    try {
      const event = pokerTableInterface.parseLog(log);
      return event?.name === "PlayerRefunded"
        && event.args.player.toLowerCase() === walletAddress.toLowerCase()
        && event.args.amount === buyIn;
    } catch {
      return false;
    }
  });
  if (!refunded) {
    throw new Error("El recibo no contiene un evento de reembolso válido para esta wallet.");
  }
}
