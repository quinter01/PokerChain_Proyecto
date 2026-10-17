import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "poker-server" }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "http://localhost:5173" } });
const rooms = new Map();

io.on("connection", (socket) => {
  socket.emit("server:message", { text: "Conectado al servidor. Esta es una sala demo." });

  socket.on("table:join", ({ tableId, walletAddress }) => {
    if (!tableId || !walletAddress) {
      socket.emit("game:error", { message: "Se requiere tableId y walletAddress." });
      return;
    }
    const roomName = String(tableId);
    const room = rooms.get(roomName) ?? new Map();
    if (room.size >= 4 && !room.has(socket.id)) {
      socket.emit("game:error", { message: "La mesa ya tiene cuatro conexiones." });
      return;
    }
    room.set(socket.id, { walletAddress, socketId: socket.id });
    rooms.set(roomName, room);
    socket.join(roomName);
    io.to(roomName).emit("table:state", {
      tableId: roomName,
      players: [...room.values()].map((p) => p.walletAddress),
      seatsTaken: room.size,
      maxPlayers: 4
    });
  });

  // Demo event only. Validate turn order, stack sizes, legal actions and
  // signed on-chain settlement in a real game before accepting wagers.
  socket.on("game:action", ({ tableId, action }) => {
    if (!tableId || !["fold", "check", "call", "raise"].includes(action?.type)) {
      socket.emit("game:error", { message: "Acción no válida." });
      return;
    }
    io.to(String(tableId)).emit("game:action", {
      player: socket.id,
      action,
      note: "Evento de demostración: aún no valida reglas ni apuestas."
    });
  });

  socket.on("disconnect", () => {
    for (const [tableId, room] of rooms.entries()) {
      if (room.delete(socket.id)) {
        io.to(tableId).emit("table:state", {
          tableId,
          players: [...room.values()].map((p) => p.walletAddress),
          seatsTaken: room.size,
          maxPlayers: 4
        });
        if (room.size === 0) rooms.delete(tableId);
      }
    }
  });
});

const port = process.env.PORT || 3001;
httpServer.listen(port, () => console.log(`Poker server escuchando en http://localhost:${port}`));