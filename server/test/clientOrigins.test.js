import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedClientOrigin } from "../src/clientOrigins.js";

test("allows local browser origins and clients without an Origin header", () => {
  assert.equal(isAllowedClientOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedClientOrigin("http://127.0.0.1:5173"), true);
  assert.equal(isAllowedClientOrigin(undefined), true);
});

test("allows private IPv4 origins for local network play", () => {
  assert.equal(isAllowedClientOrigin("http://10.110.46.47:5173"), true);
  assert.equal(isAllowedClientOrigin("http://192.168.1.50:5173"), true);
  assert.equal(isAllowedClientOrigin("http://172.20.10.2:5173"), true);
});

test("allows configured origins and rejects public or malformed origins", () => {
  assert.equal(
    isAllowedClientOrigin("https://game.example.com", ["https://game.example.com"]),
    true
  );
  assert.equal(isAllowedClientOrigin("https://game.example.com"), false);
  assert.equal(isAllowedClientOrigin("file://localhost"), false);
  assert.equal(isAllowedClientOrigin("not-an-origin"), false);
});
