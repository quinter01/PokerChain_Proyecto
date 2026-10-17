import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlayerName } from "../src/playerName.js";

test("trims and accepts a player name up to 20 characters", () => {
  assert.equal(normalizePlayerName("  Reina del póker  "), "Reina del póker");
  assert.equal(normalizePlayerName("a".repeat(20)), "a".repeat(20));
});

test("rejects empty, overlong, and control-character names", () => {
  assert.throws(() => normalizePlayerName("  "), /Escribe un nombre/);
  assert.throws(() => normalizePlayerName("a".repeat(21)), /20 caracteres/);
  assert.throws(() => normalizePlayerName("jugador\n1"), /caracteres no permitidos/);
});
