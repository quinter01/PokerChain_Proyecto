import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Contract, JsonRpcProvider, isAddress } from "ethers";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  applyAction,
  createGame,
  getPrivateState,
  getPublicState,
  startNextHand
} from "./pokerGame.js";
import { isAllowedClientOrigin } from "./clientOrigins.js";
import { normalizePlayerName } from "./playerName.js";
import { isTableHost } from "./tablePermissions.js";
import { createWalletChallenge, verifyWalletSignature } from "./walletAuth.js";
import {
  CHIPS_PER_BUY_IN,
  MONAD_TESTNET_CHAIN_ID,
  verifyBuyInTransaction,
  verifyRefundTransaction
} from "./buyInVerification.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

const contractAddress = process.env.POKER_CONTRACT_ADDRESS?.trim();
const rpcUrl = process.env.MONAD_RPC_URL?.trim() || "https://testnet-rpc.monad.xyz";
const chainProvider = contractAddress && isAddress(contractAddress)
  ? new JsonRpcProvider(rpcUrl)
  : null;
const pokerContract = chainProvider && contractAddress
  ? new Contract(contractAddress, [
    "function buyIn() view returns (uint256)",
    "function joined(address) view returns (bool)",
    "function targetPlayerCount() view returns (uint8)",
    "function playerCount() view returns (uint8)",
    "function gameStarted() view returns (bool)",
    "function tableHost() view returns (address)",
    "function tableId() view returns (uint256)",
    "function getPlayers() view returns (address[4])"
  ], chainProvider)
  : null;
let configuredBuyIn;
const RESERVATION_TIMEOUT_MS = 5 * 60 * 1000;

const app = express();
const configuredOrigins = (process.env.CLIENT_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = (origin, callback) => {
  callback(null, isAllowedClientOrigin(origin, configuredOrigins));
};
app.use(cors({ origin: corsOrigin }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "poker-server" }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: corsOrigin } });
const rooms = new Map();
const games = new Map();
const closedSettlements = new Map();
const tableSettings = new Map();
const tableHosts = new Map();
const reservations = new Map();
const depositRecords = new Map();
const usedBuyInTransactions = new Map();
const processedRefundTransactions = new Map();
const verifyingTransactions = new Set();
const settlementDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../data");
const settlementFile = join(settlementDirectory, "settlements.json");

if (existsSync(settlementFile)) {
  const savedSettlements = JSON.parse(readFileSync(settlementFile, "utf8"));
  if (!Array.isArray(savedSettlements)) {
    throw new Error("server/data/settlements.json tiene un formato inválido.");
  }
  for (const entry of savedSettlements) {
    const settlement = entry?.settlement;
    const validSettlement = typeof entry?.tableId === "string"
      && entry.tableId.length > 0
      && settlement
      && Number.isInteger(settlement.maxPlayers)
      && settlement.maxPlayers >= 2
      && settlement.maxPlayers <= 4
      && isAddress(settlement.hostAddress)
      && Array.isArray(settlement.players)
      && settlement.players.length === settlement.maxPlayers
      && settlement.players.every((player) =>
        isAddress(player.walletAddress)
        && typeof player.playerName === "string"
        && Number.isSafeInteger(player.finalChips)
        && player.finalChips >= 0
      )
      && settlement.players.reduce((total, player) => total + player.finalChips, 0)
        === settlement.maxPlayers * CHIPS_PER_BUY_IN;
    if (!validSettlement) {
      throw new Error("server/data/settlements.json contiene una distribución inválida.");
    }
    closedSettlements.set(entry.tableId, settlement);
  }
}

function persistClosedSettlements() {
  mkdirSync(settlementDirectory, { recursive: true });
  const temporaryFile = `${settlementFile}.tmp`;
  const savedSettlements = [...closedSettlements.entries()].map(([tableId, settlement]) => ({
    tableId,
    settlement
  }));
  writeFileSync(temporaryFile, `${JSON.stringify(savedSettlements, null, 2)}\n`);
  renameSync(temporaryFile, settlementFile);
}

function emitTableState(tableId, room) {
  const settlement = closedSettlements.get(tableId) ?? null;
  const pendingPlayers = [...(reservations.get(tableId)?.values() ?? [])].map((player) => ({
    walletAddress: player.walletAddress,
    playerName: player.playerName,
    paid: false,
    chips: 0
  }));
  const seatedPlayers = [...(room?.values() ?? [])].map(({ walletAddress, playerName, chips }) => ({
    walletAddress,
    playerName,
    paid: true,
    chips
  }));
  const players = settlement
    ? settlement.players.map((player) => ({
      walletAddress: player.walletAddress,
      playerName: player.playerName,
      paid: true,
      chips: player.finalChips
    }))
    : [...seatedPlayers, ...pendingPlayers];
  io.to(tableId).emit("table:state", {
    tableId,
    players,
    seatsTaken: players.length,
    maxPlayers: tableSettings.get(tableId) ?? settlement?.maxPlayers ?? 4,
    configured: tableSettings.has(tableId),
    started: games.has(tableId),
    depositCount: settlement ? settlement.players.length : seatedPlayers.length,
    hostAddress: tableHosts.get(tableId) ?? settlement?.hostAddress ?? null,
    closed: Boolean(settlement),
    settlement
  });
}

function emitGameState(tableId, game, room) {
  for (const player of game.players) {
    const seatedPlayer = room.get(player.wallet);
    if (!seatedPlayer) continue;
    seatedPlayer.chips = player.stack;
    const deposit = depositRecords.get(player.wallet);
    if (deposit) deposit.chips = player.stack;
  }
  io.to(tableId).emit("game:state", getPublicState(game));
  for (const player of room.values()) {
    const privateState = getPrivateState(game, player.walletAddress);
    if (privateState) io.to(player.socketId).emit("game:private", privateState);
  }
}

function findPlayer(room, pending, socketId) {
  return [...(room?.values() ?? []), ...(pending?.values() ?? [])]
    .find((player) => player.socketId === socketId);
}

function removeReservation(tableId, wallet) {
  const pending = reservations.get(tableId);
  const reservation = pending?.get(wallet);
  if (reservation) clearTimeout(reservation.timer);
  pending?.delete(wallet);
  if (pending?.size === 0) reservations.delete(tableId);
  return reservation;
}

function refreshTableHost(tableId) {
  const hasOnChainPlayers = [...depositRecords.values()].some((deposit) => deposit.tableId === tableId);
  if (hasOnChainPlayers) return;
  const firstPlayer = rooms.get(tableId)?.keys().next().value
    ?? reservations.get(tableId)?.keys().next().value;
  if (firstPlayer) tableHosts.set(tableId, firstPlayer);
  else tableHosts.delete(tableId);
}

async function validateGameStart(tableId, socketId, requireOnChainLock) {
  const room = rooms.get(tableId);
  const member = room && [...room.values()].find((player) => player.socketId === socketId);
  if (!member) throw new Error("Debes ocupar un asiento para iniciar la partida.");
  if (!isTableHost(tableHosts.get(tableId), member.walletAddress)) {
    throw new Error("Solo el host puede iniciar la partida.");
  }
  if (games.has(tableId) || closedSettlements.has(tableId)) {
    throw new Error("La partida ya fue iniciada.");
  }

  const maxPlayers = tableSettings.get(tableId);
  if (!maxPlayers || room.size !== maxPlayers || reservations.get(tableId)?.size) {
    throw new Error(`Se necesitan ${maxPlayers ?? "los"} jugadores con buy-in confirmado para iniciar la partida.`);
  }
  if (!pokerContract) throw new Error("El servidor no tiene un contrato de póker configurado.");

  const [gameStarted, registeredPlayers, onChainHost, onChainCount, onChainCapacity] = await Promise.all([
    pokerContract.gameStarted(),
    pokerContract.getPlayers(),
    pokerContract.tableHost(),
    pokerContract.playerCount(),
    pokerContract.targetPlayerCount()
  ]);
  if (requireOnChainLock && !gameStarted) {
    throw new Error("Bloquea la mesa on-chain antes de iniciar la partida.");
  }

  const onChainPlayers = registeredPlayers.slice(0, maxPlayers).map((address) => address.toLowerCase());
  if (Number(onChainCount) !== room.size
    || Number(onChainCapacity) !== maxPlayers
    || onChainHost.toLowerCase() !== member.walletAddress.toLowerCase()
    || onChainPlayers.length !== room.size
    || [...room.keys()].some((wallet) => !onChainPlayers.includes(wallet))) {
    throw new Error("Los depósitos on-chain no coinciden con los jugadores de la sala.");
  }
  return { room, maxPlayers };
}

io.on("connection", (socket) => {
  socket.data.tableIds = new Set();
  socket.emit("server:message", { text: "Conectado al servidor de Texas Hold'em." });

  socket.on("wallet:challenge", (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    try {
      const challenge = createWalletChallenge(String(payload?.walletAddress ?? "").trim());
      socket.data.walletChallenge = challenge;
      acknowledge({ ok: true, message: challenge.message });
    } catch {
      acknowledge({ ok: false, message: "La dirección de billetera no es válida." });
    }
  });

  socket.on("wallet:authenticate", (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const challenge = socket.data.walletChallenge;
    delete socket.data.walletChallenge;
    if (!verifyWalletSignature(challenge, payload?.signature)) {
      acknowledge({ ok: false, message: "No se pudo verificar la firma de la billetera. Inténtalo de nuevo." });
      return;
    }
    if (socket.data.walletAddress
      && socket.data.walletAddress.toLowerCase() !== challenge.walletAddress.toLowerCase()
      && socket.data.tableIds.size > 0) {
      acknowledge({
        ok: false,
        message: "Desconéctate de la sala antes de cambiar de billetera."
      });
      return;
    }

    socket.data.walletAddress = challenge.walletAddress;
    acknowledge({ ok: true, walletAddress: challenge.walletAddress });
  });

  socket.on("table:watch", (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const tableId = String(payload?.tableId ?? "").trim();
    if (!socket.data.walletAddress) {
      acknowledge({ ok: false, message: "Verifica tu wallet antes de consultar la partida." });
      return;
    }
    if (!closedSettlements.has(tableId)) {
      acknowledge({ ok: false, message: "Esta mesa todavía no tiene una distribución cerrada." });
      return;
    }
    socket.join(tableId);
    emitTableState(tableId, rooms.get(tableId));
    acknowledge({ ok: true });
  });

  socket.on("table:reserve", async (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    if (!chainProvider || !pokerContract || !contractAddress) {
      acknowledge({
        ok: false,
        message: "El servidor no tiene POKER_CONTRACT_ADDRESS configurada. Despliega el contrato y reinicia Node."
      });
      return;
    }
    try {
      const network = await chainProvider.getNetwork();
      if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
        acknowledge({
          ok: false,
          message: "El servidor no está conectado a Monad Testnet (Chain ID 10143)."
        });
        return;
      }
      if (await chainProvider.getCode(contractAddress) === "0x") {
        acknowledge({ ok: false, message: "No hay un contrato desplegado en la dirección configurada para el servidor." });
        return;
      }
      configuredBuyIn ??= await pokerContract.buyIn();
      if (await pokerContract.gameStarted()) {
        acknowledge({ ok: false, message: "La partida ya comenzó; no se aceptan nuevas reservas." });
        return;
      }
    } catch (error) {
      acknowledge({
        ok: false,
        message: `El servidor no pudo consultar el contrato en Monad Testnet: ${error.shortMessage || error.message}`
      });
      return;
    }
    const tableId = String(payload?.tableId ?? "").trim();
    const walletAddress = socket.data.walletAddress;
    const requestedPlayerCount = Number(payload?.maxPlayers);
    if (!walletAddress) {
      acknowledge({ ok: false, message: "Verifica la propiedad de tu billetera antes de entrar a la sala." });
      return;
    }
    let playerName;
    try {
      playerName = normalizePlayerName(payload?.playerName);
    } catch (error) {
      acknowledge({ ok: false, message: error.message });
      return;
    }
    if (!tableId) {
      acknowledge({ ok: false, message: "Se requiere un ID de mesa válido." });
      return;
    }
    if (!Number.isInteger(requestedPlayerCount) || requestedPlayerCount < 2 || requestedPlayerCount > 4) {
      acknowledge({ ok: false, message: "Elige una mesa de 2, 3 o 4 jugadores." });
      return;
    }
    const room = rooms.get(tableId) ?? new Map();
    const wallet = walletAddress.toLowerCase();
    const settlement = closedSettlements.get(tableId);
    if (settlement) {
      const finalPlayer = settlement.players.find((player) =>
        player.walletAddress.toLowerCase() === wallet
      );
      if (!finalPlayer) {
        acknowledge({ ok: false, message: "Esta partida está cerrada y tu billetera no participó." });
        return;
      }
      room.set(wallet, {
        walletAddress,
        playerName: finalPlayer.playerName,
        socketId: socket.id,
        chips: finalPlayer.finalChips,
        paid: true
      });
      rooms.set(tableId, room);
      tableSettings.set(tableId, settlement.maxPlayers);
      if (!tableHosts.has(tableId)) tableHosts.set(tableId, settlement.hostAddress.toLowerCase());
      socket.data.tableIds.add(tableId);
      socket.join(tableId);
      emitTableState(tableId, room);
      acknowledge({ ok: true, alreadyPaid: true, closed: true, chips: finalPlayer.finalChips });
      return;
    }
    const activeGame = games.get(tableId);
    const activeGamePlayer = activeGame?.players.find((player) => player.wallet === wallet);
    const existingDeposit = depositRecords.get(wallet);
    const paidForThisTable = existingDeposit?.tableId === tableId;
    if (activeGame && !activeGamePlayer && !paidForThisTable) {
      acknowledge({ ok: false, message: "La partida ya inició; no se aceptan nuevos buy-ins." });
      return;
    }
    if (room.has(wallet)) {
      const seatedPlayer = room.get(wallet);
      seatedPlayer.socketId = socket.id;
      socket.data.tableIds.add(tableId);
      socket.join(tableId);
      emitTableState(tableId, room);
      if (activeGame) emitGameState(tableId, activeGame, room);
      acknowledge({ ok: true, alreadyPaid: true, chips: seatedPlayer.chips });
      return;
    }
    if (activeGame && (activeGamePlayer || paidForThisTable)) {
      room.set(wallet, {
        walletAddress,
        playerName: existingDeposit?.playerName ?? playerName,
        socketId: socket.id,
        chips: activeGamePlayer?.stack ?? 0,
        paid: true
      });
      rooms.set(tableId, room);
      socket.data.tableIds.add(tableId);
      socket.join(tableId);
      emitTableState(tableId, room);
      emitGameState(tableId, activeGame, room);
      acknowledge({ ok: true, alreadyPaid: true, chips: activeGamePlayer?.stack ?? 0 });
      return;
    }
    if (games.has(tableId)) {
      acknowledge({ ok: false, message: "La partida ya inició; no se aceptan nuevos buy-ins." });
      return;
    }

    const configuredPlayerCount = tableSettings.get(tableId);
    if (configuredPlayerCount !== undefined && configuredPlayerCount !== requestedPlayerCount) {
      acknowledge({
        ok: false,
        message: `Esta mesa está configurada para ${configuredPlayerCount} jugadores. Selecciona esa cantidad.`
      });
      return;
    }

    const deposit = depositRecords.get(wallet);
    if (deposit) {
      if (deposit.tableId !== tableId) {
        acknowledge({
          ok: false,
          message: "Esta billetera ya utilizó su buy-in en otra sala; cada contrato admite un solo buy-in por jugador."
        });
        return;
      }
      if (deposit.playerCount !== requestedPlayerCount) {
        acknowledge({
          ok: false,
          message: `Tu buy-in quedó registrado para una mesa de ${deposit.playerCount} jugadores.`
        });
        return;
      }
      if (room.size >= requestedPlayerCount) {
        acknowledge({ ok: false, message: `La mesa ya tiene ${requestedPlayerCount} jugadores.` });
        return;
      }
      room.set(wallet, {
        walletAddress,
        playerName,
        socketId: socket.id,
        chips: deposit.chips
      });
      rooms.set(tableId, room);
      tableSettings.set(tableId, deposit.playerCount);
      if (!tableHosts.has(tableId)) tableHosts.set(tableId, wallet);
      socket.data.tableIds.add(tableId);
      socket.join(tableId);
      emitTableState(tableId, room);
      acknowledge({ ok: true, alreadyPaid: true, chips: deposit.chips });
      return;
    }

    const maxPlayers = configuredPlayerCount ?? requestedPlayerCount;
    const pending = reservations.get(tableId) ?? new Map();
    const seatsInUse = room.size + pending.size - (pending.has(wallet) ? 1 : 0);
    if (seatsInUse >= maxPlayers) {
      acknowledge({ ok: false, message: `La mesa ya tiene ${maxPlayers} jugadores.` });
      return;
    }
    if (!tableHosts.has(tableId)) tableHosts.set(tableId, wallet);
    tableSettings.set(tableId, maxPlayers);
    const previousReservation = removeReservation(tableId, wallet);
    if (previousReservation) clearTimeout(previousReservation.timer);
    const reservation = { walletAddress, playerName, socketId: socket.id, playerCount: maxPlayers };
    reservation.timer = setTimeout(() => {
      const expired = removeReservation(tableId, wallet);
      if (!expired) return;
      const currentRoom = rooms.get(tableId);
      refreshTableHost(tableId);
      emitTableState(tableId, currentRoom);
      if (!currentRoom?.size && !reservations.has(tableId)) {
        tableSettings.delete(tableId);
      }
      if (!currentRoom?.has(wallet)) {
        socket.data.tableIds.delete(tableId);
        socket.leave(tableId);
      }
      socket.emit("game:error", {
        message: "La reserva de asiento expiró. Vuelve a solicitarla antes de pagar."
      });
    }, RESERVATION_TIMEOUT_MS);
    reservation.timer.unref();
    pending.set(wallet, reservation);
    reservations.set(tableId, pending);
    socket.data.tableIds.add(tableId);
    socket.join(tableId);
    emitTableState(tableId, room);
    acknowledge({ ok: true, alreadyPaid: false, buyInWei: configuredBuyIn.toString() });
  });

  socket.on("buyin:verify", async (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const walletAddress = socket.data.walletAddress;
    const tableId = String(payload?.tableId ?? "").trim();
    const transactionHash = String(payload?.transactionHash ?? "").trim();
    const wallet = walletAddress?.toLowerCase();
    const reservation = reservations.get(tableId)?.get(wallet);
    if (!walletAddress || !reservation || reservation.socketId !== socket.id) {
      acknowledge({ ok: false, message: "Reserva un asiento antes de confirmar el buy-in." });
      return;
    }
    if (!chainProvider || !pokerContract || !contractAddress) {
      acknowledge({
        ok: false,
        message: "El servidor no tiene POKER_CONTRACT_ADDRESS configurada. Despliega el contrato y reinicia Node."
      });
      return;
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
      acknowledge({ ok: false, message: "El identificador de transacción no tiene un formato válido." });
      return;
    }
    const previousUse = usedBuyInTransactions.get(transactionHash.toLowerCase());
    if (previousUse) {
      acknowledge({
        ok: false,
        message: "Esta transacción ya fue utilizada para acreditar un buy-in."
      });
      return;
    }
    if (verifyingTransactions.has(transactionHash.toLowerCase())) {
      acknowledge({ ok: false, message: "Esta transacción ya se está verificando." });
      return;
    }

    verifyingTransactions.add(transactionHash.toLowerCase());
    try {
      const network = await chainProvider.getNetwork();
      if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
        throw new Error("El RPC del servidor no está conectado a Monad Testnet (Chain ID 10143).");
      }
      const transaction = await chainProvider.getTransaction(transactionHash);
      const receipt = await chainProvider.getTransactionReceipt(transactionHash);
      if (!transaction || !receipt || receipt.status !== 1) {
        throw new Error("La transacción de buy-in no existe o no fue confirmada correctamente.");
      }
      verifyBuyInTransaction({
        transaction,
        receipt,
        contractAddress,
        walletAddress,
        playerCount: reservation.playerCount,
        buyIn: configuredBuyIn ?? await pokerContract.buyIn()
      });
      const isJoined = await pokerContract.joined(walletAddress);
      const onChainPlayerCount = await pokerContract.targetPlayerCount();
      const onChainTableHost = await pokerContract.tableHost();
      const onChainGameStarted = await pokerContract.gameStarted();
      if (!isJoined || Number(onChainPlayerCount) !== reservation.playerCount || onChainGameStarted) {
        throw new Error("El contrato no confirma el buy-in para esta billetera y cantidad de jugadores.");
      }

      removeReservation(tableId, wallet);
      const room = rooms.get(tableId) ?? new Map();
      room.set(wallet, {
        walletAddress,
        playerName: reservation.playerName,
        socketId: socket.id,
        chips: CHIPS_PER_BUY_IN,
        paid: true
      });
      rooms.set(tableId, room);
      tableHosts.set(tableId, onChainTableHost.toLowerCase());
      depositRecords.set(wallet, {
        tableId,
        transactionHash,
        playerCount: reservation.playerCount,
        playerName: reservation.playerName,
        chips: CHIPS_PER_BUY_IN
      });
      usedBuyInTransactions.set(transactionHash.toLowerCase(), wallet);
      socket.data.tableIds.add(tableId);
      socket.join(tableId);
      emitTableState(tableId, room);
      acknowledge({ ok: true, chips: CHIPS_PER_BUY_IN });
    } catch (error) {
      acknowledge({
        ok: false,
        message: error.message || "No se pudo verificar el depósito en Monad Testnet."
      });
    } finally {
      verifyingTransactions.delete(transactionHash.toLowerCase());
    }
  });

  socket.on("buyin:refund", async (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const walletAddress = socket.data.walletAddress;
    const tableId = String(payload?.tableId ?? "").trim();
    const transactionHash = String(payload?.transactionHash ?? "").trim();
    const wallet = walletAddress?.toLowerCase();
    if (!walletAddress || !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
      acknowledge({ ok: false, message: "La wallet o el identificador de transacción no es válido." });
      return;
    }
    const processedRefund = processedRefundTransactions.get(transactionHash.toLowerCase());
    if (processedRefund) {
      if (processedRefund.wallet === wallet && processedRefund.tableId === tableId) {
        acknowledge({ ok: true, alreadyRefunded: true });
      } else {
        acknowledge({ ok: false, message: "Esta transacción de reembolso ya fue utilizada." });
      }
      return;
    }
    const room = rooms.get(tableId);
    const player = room?.get(wallet);
    const deposit = depositRecords.get(wallet);
    if ((player && player.socketId !== socket.id) || (deposit && deposit.tableId !== tableId)) {
      acknowledge({ ok: false, message: "La wallet no coincide con el asiento de esta sala." });
      return;
    }
    if (games.has(tableId)) {
      acknowledge({ ok: false, message: "El servidor ya inició la partida; el reembolso de sala de espera no está disponible." });
      return;
    }
    const refundLock = `refund:${transactionHash.toLowerCase()}`;
    if (verifyingTransactions.has(refundLock)) {
      acknowledge({ ok: false, message: "Este reembolso ya se está verificando." });
      return;
    }

    verifyingTransactions.add(refundLock);
    try {
      if (!chainProvider || !pokerContract || !contractAddress) {
        throw new Error("El servidor no tiene POKER_CONTRACT_ADDRESS configurada.");
      }
      const network = await chainProvider.getNetwork();
      if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
        throw new Error("El RPC del servidor no está conectado a Monad Testnet (Chain ID 10143).");
      }
      const transaction = await chainProvider.getTransaction(transactionHash);
      const receipt = await chainProvider.getTransactionReceipt(transactionHash);
      verifyRefundTransaction({
        transaction,
        receipt,
        contractAddress,
        walletAddress,
        buyIn: configuredBuyIn ?? await pokerContract.buyIn()
      });
      const [stillJoined, gameStarted, remainingCount, targetCount, nextHost, onChainTableId] = await Promise.all([
        pokerContract.joined(walletAddress),
        pokerContract.gameStarted(),
        pokerContract.playerCount(),
        pokerContract.targetPlayerCount(),
        pokerContract.tableHost(),
        pokerContract.tableId()
      ]);
      if (stillJoined || gameStarted) {
        throw new Error("El contrato todavía no confirma que tu asiento fue reembolsado antes de iniciar.");
      }
      if (!player && !deposit && onChainTableId.toString() !== tableId) {
        throw new Error("No se encontró la reserva de esta wallet para la mesa indicada.");
      }

      room?.delete(wallet);
      depositRecords.delete(wallet);
      if (deposit) usedBuyInTransactions.delete(deposit.transactionHash.toLowerCase());
      processedRefundTransactions.set(transactionHash.toLowerCase(), { wallet, tableId });

      if (Number(remainingCount) === 0) {
        if (!room?.size) rooms.delete(tableId);
        if (reservations.get(tableId)?.size) {
          tableSettings.set(tableId, reservations.get(tableId).values().next().value.playerCount);
          refreshTableHost(tableId);
        } else {
          tableSettings.delete(tableId);
          tableHosts.delete(tableId);
        }
      } else {
        tableSettings.set(tableId, Number(targetCount));
        tableHosts.set(tableId, nextHost.toLowerCase());
      }
      emitTableState(tableId, rooms.get(tableId));
      const connectedSocket = io.sockets.sockets.get(player.socketId);
      connectedSocket?.data.tableIds.delete(tableId);
      connectedSocket?.leave(tableId);
      acknowledge({ ok: true, refundedWei: configuredBuyIn.toString() });
    } catch (error) {
      acknowledge({
        ok: false,
        message: error.message || "No se pudo verificar el reembolso en Monad Testnet."
      });
    } finally {
      verifyingTransactions.delete(refundLock);
    }
  });

  socket.on("table:join", (_payload) => {
    socket.emit("game:error", {
      message: "Para entrar, reserva un asiento y confirma el depósito de 0.01 MON."
    });
  });

  socket.on("table:configure", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const requestedPlayerCount = Number(payload?.maxPlayers);
    const room = rooms.get(tableId);
    const member = findPlayer(room, reservations.get(tableId), socket.id);
    if (!member) {
      socket.emit("game:error", { message: "Debes estar en la sala para cambiar su capacidad." });
      return;
    }
    if (!isTableHost(tableHosts.get(tableId), member.walletAddress)) {
      socket.emit("game:error", { message: "Solo el host puede cambiar la capacidad de la sala." });
      return;
    }
    if (games.has(tableId)) {
      socket.emit("game:error", { message: "No puedes cambiar la capacidad durante una partida." });
      return;
    }
    if (closedSettlements.has(tableId)) {
      socket.emit("game:error", { message: "La partida está cerrada y no admite cambios." });
      return;
    }
    if (room?.size || reservations.get(tableId)?.size) {
      socket.emit("game:error", {
        message: "La capacidad queda fijada cuando comienza el primer depósito on-chain."
      });
      return;
    }
    if (!Number.isInteger(requestedPlayerCount) || requestedPlayerCount < 2 || requestedPlayerCount > 4) {
      socket.emit("game:error", { message: "Elige una mesa de 2, 3 o 4 jugadores." });
      return;
    }
    if (requestedPlayerCount < room.size) {
      socket.emit("game:error", {
        message: `No puedes configurar ${requestedPlayerCount} asientos: ya hay ${room.size} jugadores en la sala.`
      });
      return;
    }

    tableSettings.set(tableId, requestedPlayerCount);
    emitTableState(tableId, room);
  });

  socket.on("game:validateStart", async (payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const tableId = String(payload?.tableId ?? "").trim();
    try {
      await validateGameStart(tableId, socket.id, false);
      acknowledge({ ok: true });
    } catch (error) {
      acknowledge({ ok: false, message: error.message });
    }
  });

  socket.on("game:start", async (payload, acknowledge) => {
    const respond = (response) => {
      if (typeof acknowledge === "function") acknowledge(response);
      if (!response.ok) socket.emit("game:error", { message: response.message });
    };
    const tableId = String(payload?.tableId ?? "").trim();
    try {
      const { room } = await validateGameStart(tableId, socket.id, true);
      const game = createGame([...room.values()].map((player) => ({
        wallet: player.walletAddress,
        stack: player.chips
      })));
      games.set(tableId, game);
      emitTableState(tableId, room);
      emitGameState(tableId, game, room);
      respond({ ok: true });
    } catch (error) {
      respond({ ok: false, message: error.message });
    }
  });

  socket.on("game:action", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
    const game = games.get(tableId);
    if (!member || !game || closedSettlements.has(tableId)) {
      socket.emit("game:error", { message: "Debes ocupar un asiento en una partida activa." });
      return;
    }
    try {
      applyAction(game, member.walletAddress, payload.action);
      io.to(tableId).emit("game:action", {
        player: member.walletAddress,
        action: payload.action
      });
      emitGameState(tableId, game, room);
    } catch (error) {
      socket.emit("game:error", { message: error.message });
    }
  });

  socket.on("game:nextHand", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
    const game = games.get(tableId);
    if (!member || !game || closedSettlements.has(tableId)) {
      socket.emit("game:error", { message: "Debes ocupar un asiento en esta mesa." });
      return;
    }
    if (!isTableHost(tableHosts.get(tableId), member.walletAddress)) {
      socket.emit("game:error", { message: "Solo el host puede iniciar una nueva mano." });
      return;
    }
    try {
      const nextGame = startNextHand(game);
      games.set(tableId, nextGame);
      emitGameState(tableId, nextGame, room);
    } catch (error) {
      socket.emit("game:error", { message: error.message });
    }
  });

  socket.on("game:close", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
    const game = games.get(tableId);
    if (!member || !game) {
      socket.emit("game:error", { message: "Debes estar en una partida para poder cerrarla." });
      return;
    }
    if (!isTableHost(tableHosts.get(tableId), member.walletAddress)) {
      socket.emit("game:error", { message: "Solo el host puede cerrar la partida y habilitar los retiros." });
      return;
    }
    if (closedSettlements.has(tableId)) {
      socket.emit("game:error", { message: "La partida ya está cerrada y lista para los retiros." });
      return;
    }
    if (game.phase !== "complete") {
      socket.emit("game:error", { message: "Termina la mano actual antes de habilitar los retiros." });
      return;
    }
    if (room.size !== tableSettings.get(tableId)) {
      socket.emit("game:error", { message: "Deben estar conectados todos los jugadores pagados para cerrar la partida." });
      return;
    }

    closedSettlements.set(tableId, {
      maxPlayers: tableSettings.get(tableId),
      hostAddress: tableHosts.get(tableId),
      players: [...room.values()].map((seatedPlayer) => {
        const gamePlayer = game.players.find((player) =>
          player.wallet === seatedPlayer.walletAddress.toLowerCase()
        );
        return {
          walletAddress: seatedPlayer.walletAddress,
          playerName: seatedPlayer.playerName,
          finalChips: gamePlayer?.stack ?? 0
        };
      })
    });
    try {
      persistClosedSettlements();
    } catch (error) {
      closedSettlements.delete(tableId);
      socket.emit("game:error", {
        message: `No se pudo guardar la distribución para retiros: ${error.message}`
      });
      return;
    }
    emitTableState(tableId, room);
  });

  socket.on("table:cancelReservation", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const wallet = socket.data.walletAddress?.toLowerCase();
    const reservation = reservations.get(tableId)?.get(wallet);
    if (!reservation || reservation.socketId !== socket.id) return;
    removeReservation(tableId, wallet);
    const room = rooms.get(tableId);
    if (!room?.size && !reservations.has(tableId)) {
      tableSettings.delete(tableId);
    }
    refreshTableHost(tableId);
    if (!room?.has(wallet)) {
      socket.data.tableIds.delete(tableId);
      socket.leave(tableId);
    }
    emitTableState(tableId, room);
  });

  socket.on("disconnect", () => {
    for (const tableId of socket.data.tableIds) {
      const room = rooms.get(tableId);
      const pending = reservations.get(tableId);
      const wallet = [...(room?.entries() ?? [])]
        .find(([, player]) => player.socketId === socket.id)?.[0];
      const pendingWallet = [...(pending?.entries() ?? [])]
        .find(([, player]) => player.socketId === socket.id)?.[0];
      if (wallet) room.delete(wallet);
      if (pendingWallet) removeReservation(tableId, pendingWallet);
      refreshTableHost(tableId);
      emitTableState(tableId, room);
      if (!room?.size && !reservations.has(tableId)) {
        rooms.delete(tableId);
        games.delete(tableId);
        tableSettings.delete(tableId);
      } else if (games.has(tableId) && wallet) {
        io.to(tableId).emit("game:error", {
          message: "Un jugador se desconectó. Esta mano queda pausada."
        });
      }
    }
  });
});

const port = process.env.PORT || 3001;
const host = process.env.HOST || "0.0.0.0";
httpServer.listen(port, host, () =>
  console.log(`Poker server escuchando en http://${host}:${port}`)
);