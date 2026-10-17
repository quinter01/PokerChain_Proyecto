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
      { walletAddress: "0xplayer1", playerName: "Jugador 1", paid: true, chips: 1000 },
      { walletAddress: "0xplayer2", playerName: "Jugador 2", paid: true, chips: 1000 }
    ],
    seatsTaken: 2,
    maxPlayers: 2,
    depositCount: 2,
    configured: true,
    started: false,
    hostAddress: null,
    closed: false,
    settlement: null
  });
});

test("preserves player names and lobby flags from the current server", () => {
  const state = normalizeTableState({
    tableId: "mesa",
    players: [{ walletAddress: "0xplayer1", playerName: "Reina" }],
    seatsTaken: 1,
    maxPlayers: 3,
    configured: true,
    started: true,
    closed: true,
    settlement: {
      players: [{ walletAddress: "0xplayer1", playerName: "Reina", finalChips: 1000 }]
    },
    hostAddress: "0xplayer1"
  });
  assert.equal(state.hostAddress, "0xplayer1");
  assert.equal(state.closed, true);
  assert.equal(state.settlement.players[0].finalChips, 1000);
});

test("preserves pending buy-ins and verified chip balances", () => {
  const state = normalizeTableState({
    tableId: "mesa",
    players: [
      { walletAddress: "0xpaid", playerName: "Pagó", paid: true, chips: 975 },
      { walletAddress: "0xpending", playerName: "Pendiente", paid: false, chips: 0 }
    ],
    seatsTaken: 2,
    depositCount: 1,
    maxPlayers: 2
  });

  assert.equal(state.players[0].chips, 975);
  assert.equal(state.players[1].paid, false);
  assert.equal(state.depositCount, 1);
});

test("rejects malformed room state instead of crashing later in the UI", () => {
  assert.throws(() => normalizeTableState(null), /estado de sala no válido/);
  assert.throws(() => normalizeTableState({ players: [null] }), /jugador sin billetera/);
});
