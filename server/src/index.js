import express from "express";
import cors from "cors";
import { createServer } from "node:http";
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
const tableSettings = new Map();
const tableHosts = new Map();

function emitTableState(tableId, room) {
  io.to(tableId).emit("table:state", {
    tableId,
    players: [...room.values()].map(({ walletAddress, playerName }) => ({
      walletAddress,
      playerName
    })),
    seatsTaken: room.size,
    maxPlayers: tableSettings.get(tableId) ?? 4,
    configured: tableSettings.has(tableId),
    started: games.has(tableId),
    hostAddress: tableHosts.get(tableId) ?? null
  });
}

function emitGameState(tableId, game, room) {
  io.to(tableId).emit("game:state", getPublicState(game));
  for (const player of room.values()) {
    const privateState = getPrivateState(game, player.walletAddress);
    if (privateState) io.to(player.socketId).emit("game:private", privateState);
  }
}

io.on("connection", (socket) => {
  socket.data.tableIds = new Set();
  socket.emit("server:message", { text: "Conectado al servidor de Texas Hold'em." });

  socket.on("table:join", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const walletAddress = String(payload?.walletAddress ?? "").trim();
    const requestedPlayerCount = Number(payload?.maxPlayers);
    let playerName;
    try {
      playerName = normalizePlayerName(payload?.playerName);
    } catch (error) {
      socket.emit("game:error", { message: error.message });
      return;
    }
    if (!tableId || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      socket.emit("game:error", { message: "Se requiere tableId y walletAddress." });
      return;
    }
    if (!Number.isInteger(requestedPlayerCount) || requestedPlayerCount < 2 || requestedPlayerCount > 4) {
      socket.emit("game:error", { message: "Elige una mesa de 2, 3 o 4 jugadores." });
      return;
    }
    const room = rooms.get(tableId) ?? new Map();
    const wallet = walletAddress.toLowerCase();
    const activeGame = games.get(tableId);
    if (activeGame && !activeGame.players.some((player) => player.wallet === wallet)) {
      socket.emit("game:error", {
        message: "La partida ya inició; solo pueden volver a conectarse los jugadores de esta mano."
      });
      return;
    }
    const configuredPlayerCount = tableSettings.get(tableId);
    if (configuredPlayerCount !== undefined && configuredPlayerCount !== requestedPlayerCount) {
      socket.emit("game:error", {
        message: `Esta mesa está configurada para ${configuredPlayerCount} jugadores. Selecciona esa cantidad.`
      });
      return;
    }
    const maxPlayers = configuredPlayerCount ?? requestedPlayerCount;
    if (room.size >= maxPlayers && !room.has(wallet)) {
      socket.emit("game:error", { message: `La mesa ya tiene ${maxPlayers} jugadores.` });
      return;
    }
    if (!tableHosts.has(tableId)) tableHosts.set(tableId, wallet);
    tableSettings.set(tableId, maxPlayers);
    room.set(wallet, { walletAddress, playerName, socketId: socket.id });
    rooms.set(tableId, room);
    socket.data.tableIds.add(tableId);
    socket.join(tableId);
    emitTableState(tableId, room);

    const game = games.get(tableId);
    if (game) emitGameState(tableId, game, room);
  });

  socket.on("table:configure", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const requestedPlayerCount = Number(payload?.maxPlayers);
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
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

  socket.on("game:start", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
    if (!member) {
      socket.emit("game:error", { message: "Debes ocupar un asiento para iniciar la partida." });
      return;
    }
    if (!isTableHost(tableHosts.get(tableId), member.walletAddress)) {
      socket.emit("game:error", { message: "Solo el host puede iniciar la partida." });
      return;
    }
    if (games.has(tableId)) {
      socket.emit("game:error", { message: "La partida ya fue iniciada." });
      return;
    }
    const maxPlayers = tableSettings.get(tableId);
    if (!maxPlayers || room.size !== maxPlayers) {
      socket.emit("game:error", {
        message: `Se necesitan ${maxPlayers ?? "los"} jugadores para iniciar la partida.`
      });
      return;
    }

    try {
      const game = createGame([...room.keys()]);
      games.set(tableId, game);
      emitTableState(tableId, room);
      emitGameState(tableId, game, room);
    } catch (error) {
      socket.emit("game:error", { message: error.message });
    }
  });

  socket.on("game:action", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
    const game = games.get(tableId);
    if (!member || !game) {
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
    if (!member || !game) {
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

  socket.on("game:resetLobby", (payload) => {
    const tableId = String(payload?.tableId ?? "").trim();
    const room = rooms.get(tableId);
    const member = room && [...room.values()].find((player) => player.socketId === socket.id);
    const game = games.get(tableId);
    if (!member || !game) {
      socket.emit("game:error", { message: "Debes estar en una partida terminada para abrir una nueva sala." });
      return;
    }
    if (!isTableHost(tableHosts.get(tableId), member.walletAddress)) {
      socket.emit("game:error", { message: "Solo el host puede iniciar una nueva partida." });
      return;
    }
    if (game.phase !== "complete") {
      socket.emit("game:error", { message: "Termina la mano actual antes de iniciar una nueva partida." });
      return;
    }

    games.delete(tableId);
    tableSettings.delete(tableId);
    emitTableState(tableId, room);
  });

  socket.on("disconnect", () => {
    for (const tableId of socket.data.tableIds) {
      const room = rooms.get(tableId);
      if (!room) continue;
      const wallet = [...room.entries()]
        .find(([, player]) => player.socketId === socket.id)?.[0];
      if (wallet) room.delete(wallet);
      emitTableState(tableId, room);
      if (room.size === 0) {
        rooms.delete(tableId);
        games.delete(tableId);
        tableSettings.delete(tableId);
        tableHosts.delete(tableId);
      } else if (games.has(tableId)) {
        io.to(tableId).emit("game:error", {
          message: "Un jugador se desconectó. Esta mano queda pausada."
        });
      }
    }
  });
});

const port = process.env.PORT || 3001;
httpServer.listen(port, "0.0.0.0", () =>
  console.log(`Poker server escuchando en http://0.0.0.0:${port}`)
);