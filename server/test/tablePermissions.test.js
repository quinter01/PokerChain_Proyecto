import test from "node:test";
import assert from "node:assert/strict";
import { isTableHost } from "../src/tablePermissions.js";

test("recognizes the host address without case sensitivity", () => {
  assert.equal(isTableHost("0xAbC", "0xaBc"), true);
});

test("does not grant host permissions to other or missing players", () => {
  assert.equal(isTableHost("0xhost", "0xguest"), false);
  assert.equal(isTableHost(null, "0xguest"), false);
  assert.equal(isTableHost("0xhost", undefined), false);
});
