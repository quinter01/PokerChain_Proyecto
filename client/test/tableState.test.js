import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTableState } from "../src/tableState.js";

test("normalizes legacy room states containing wallet strings", () => {
  assert.deepEqual(normalizeTableState({
    tableId: 12,
    players: ["0xplayer1", "0xplayer2"],
    seatsTaken: 2,
    maxPlayers: 2
  }), {
    tableId: "12",
    players: [
      { walletAddress: "0xplayer1", playerName: "Jugador 1" },
      { walletAddress: "0xplayer2", playerName: "Jugador 2" }
    ],
    seatsTaken: 2,
    maxPlayers: 2,
    configured: true,
    started: false,
    hostAddress: null
  });
});

test("preserves player names and lobby flags from the current server", () => {
  assert.deepEqual(normalizeTableState({
    tableId: "mesa",
    players: [{ walletAddress: "0xplayer1", playerName: "Reina" }],
    seatsTaken: 1,
    maxPlayers: 3,
    configured: true,
    started: true,
    hostAddress: "0xplayer1"
  }).hostAddress, "0xplayer1");
});

test("rejects malformed room state instead of crashing later in the UI", () => {
  assert.throws(() => normalizeTableState(null), /estado de sala no válido/);
  assert.throws(() => normalizeTableState({ players: [null] }), /jugador sin billetera/);
});
