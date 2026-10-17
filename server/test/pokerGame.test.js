import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  createGame,
  evaluateHand,
  getPrivateState,
  getPublicState,
  startNextHand
} from "../src/pokerGame.js";

const wallets = ["0x01", "0x02", "0x03", "0x04"];

test("starts a four-player hand and keeps private cards out of public state", () => {
  const game = createGame(wallets);
  const publicState = getPublicState(game);

  assert.equal(publicState.phase, "preflop");
  assert.equal(publicState.pot, 30);
  assert.equal(publicState.players.length, 4);
  assert.equal("holeCards" in publicState.players[0], false);
  assert.equal(getPrivateState(game, wallets[0]).holeCards.length, 2);
});

test("starts hands with two or three players", () => {
  for (const count of [2, 3]) {
    const game = createGame(wallets.slice(0, count));
    assert.equal(game.players.length, count);
    assert.equal(game.phase, "preflop");
    assert.equal(game.pot, 30);
  }
});

test("checks turn order, betting rules, and advances to the flop", () => {
  const game = createGame(wallets);

  assert.throws(() => applyAction(game, wallets[0], { type: "call" }), /No es tu turno/);
  assert.throws(() => applyAction(game, wallets[3], { type: "check" }), /No puedes pasar/);
  applyAction(game, wallets[3], { type: "raise", amount: 20 });
  applyAction(game, wallets[0], { type: "call" });
  applyAction(game, wallets[1], { type: "call" });
  applyAction(game, wallets[2], { type: "call" });

  const state = getPublicState(game);
  assert.equal(state.phase, "flop");
  assert.equal(state.pot, 160);
  assert.equal(state.board.length, 3);
});

test("awards the pot when all but one player folds and starts another hand", () => {
  const game = createGame(wallets);
  applyAction(game, wallets[3], { type: "fold" });
  applyAction(game, wallets[0], { type: "fold" });
  applyAction(game, wallets[1], { type: "fold" });

  assert.equal(game.phase, "complete");
  assert.deepEqual(game.winners.map((winner) => winner.wallet), [wallets[2]]);
  assert.equal(game.winners[0].hand, null);
  assert.equal(game.players.find((player) => player.wallet === wallets[2]).stack, 1010);

  const nextGame = startNextHand(game);
  assert.equal(nextGame.phase, "preflop");
  assert.equal(
    nextGame.players.reduce((total, player) => total + player.stack, nextGame.pot),
    4000
  );
});

test("plays through showdown, reveals hands, and preserves all chips", () => {
  const game = createGame(wallets);
  applyAction(game, wallets[3], { type: "call" });
  applyAction(game, wallets[0], { type: "call" });
  applyAction(game, wallets[1], { type: "call" });
  applyAction(game, wallets[2], { type: "check" });

  for (let street = 0; street < 3; street++) {
    for (const wallet of [wallets[1], wallets[2], wallets[3], wallets[0]]) {
      applyAction(game, wallet, { type: "check" });
    }
  }

  const state = getPublicState(game);
  assert.equal(state.phase, "complete");
  assert.equal(state.board.length, 5);
  assert.ok(state.winners.length >= 1);
  assert.ok(state.winners.every((winner) => typeof winner.hand === "string"));
  assert.ok(state.players.every((player) => player.holeCards.length === 2));
  assert.equal(
    state.players.reduce((total, player) => total + player.stack, state.pot),
    wallets.length * 1000
  );
});

test("splits the pot between players tied with the community straight", () => {
  const game = createGame(wallets.slice(0, 2));
  const usedCards = game.players.flatMap((player) => player.holeCards);
  const suits = ["clubs", "diamonds", "hearts", "spades"];
  const suitCounts = new Map(suits.map((suit) => [suit, 0]));
  const board = [10, 11, 12, 13, 14].map((rank, index) => {
    const availableSuits = suits
      .filter((candidate) =>
        !usedCards.some((card) => card.rank === rank && card.suit === candidate)
      )
      .sort((left, right) => suitCounts.get(left) - suitCounts.get(right));
    const suit = availableSuits[0] ?? suits[index % suits.length];
    suitCounts.set(suit, (suitCounts.get(suit) ?? 0) + 1);
    return { rank, suit };
  });
  const burn = { rank: 2, suit: "clubs" };
  game.deck = [
    board[4],
    burn,
    board[3],
    burn,
    board[2],
    board[1],
    board[0],
    burn
  ];

  applyAction(game, wallets[0], { type: "call" });
  applyAction(game, wallets[1], { type: "check" });
  for (let street = 0; street < 3; street++) {
    applyAction(game, wallets[1], { type: "check" });
    applyAction(game, wallets[0], { type: "check" });
  }

  assert.equal(game.phase, "complete");
  assert.deepEqual(game.winners, [
    { wallet: wallets[0], hand: "Escalera" },
    { wallet: wallets[1], hand: "Escalera" }
  ]);
  assert.equal(game.players[0].stack, 1000);
  assert.equal(game.players[1].stack, 1000);
});

test("evaluates a wheel straight and ranks a straight flush above four of a kind", () => {
  const wheel = evaluateHand([
    { rank: 14, suit: "clubs" },
    { rank: 2, suit: "diamonds" },
    { rank: 3, suit: "hearts" },
    { rank: 4, suit: "spades" },
    { rank: 5, suit: "clubs" }
  ]);
  const straightFlush = evaluateHand([
    { rank: 9, suit: "hearts" },
    { rank: 10, suit: "hearts" },
    { rank: 11, suit: "hearts" },
    { rank: 12, suit: "hearts" },
    { rank: 13, suit: "hearts" },
    { rank: 7, suit: "clubs" },
    { rank: 7, suit: "diamonds" }
  ]);
  const fourOfAKind = evaluateHand([
    { rank: 8, suit: "clubs" },
    { rank: 8, suit: "diamonds" },
    { rank: 8, suit: "hearts" },
    { rank: 8, suit: "spades" },
    { rank: 14, suit: "clubs" }
  ]);

  assert.deepEqual(wheel.score, [4, 5]);
  assert.equal(straightFlush.name, "Escalera de color");
  assert.ok(straightFlush.score[0] > fourOfAKind.score[0]);
});

test("recognizes a full house made from two three-of-a-kind groups", () => {
  const hand = evaluateHand([
    { rank: 9, suit: "clubs" },
    { rank: 9, suit: "diamonds" },
    { rank: 9, suit: "hearts" },
    { rank: 4, suit: "clubs" },
    { rank: 4, suit: "diamonds" },
    { rank: 4, suit: "hearts" },
    { rank: 2, suit: "spades" }
  ]);

  assert.equal(hand.name, "Full house");
  assert.deepEqual(hand.score, [6, 9, 4]);
});
