import { randomInt } from "node:crypto";

export const STARTING_STACK = 1000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const MAX_PLAYERS = 4;

const SUITS = ["clubs", "diamonds", "hearts", "spades"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const STREET_ORDER = ["preflop", "flop", "turn", "river"];
const HAND_NAMES = [
  "Carta alta",
  "Pareja",
  "Doble pareja",
  "Trío",
  "Escalera",
  "Color",
  "Full house",
  "Póker",
  "Escalera de color"
];

function createDeck() {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function compareScores(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function straightHigh(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  return 0;
}

function scoreFive(cards) {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(ranks);

  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] >= 2) {
    return [6, groups[0][0], groups[1][0]];
  }
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) {
    return [3, groups[0][0], ...groups.slice(1).map(([rank]) => rank)];
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return [2, groups[0][0], groups[1][0], groups[2][0]];
  }
  if (groups[0][1] === 2) {
    return [1, groups[0][0], ...groups.slice(1).map(([rank]) => rank)];
  }
  return [0, ...ranks];
}

export function evaluateHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) {
    throw new Error("La mano debe contener entre cinco y siete cartas.");
  }

  let bestScore = null;
  for (let a = 0; a < cards.length - 4; a++) {
    for (let b = a + 1; b < cards.length - 3; b++) {
      for (let c = b + 1; c < cards.length - 2; c++) {
        for (let d = c + 1; d < cards.length - 1; d++) {
          for (let e = d + 1; e < cards.length; e++) {
            const score = scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!bestScore || compareScores(score, bestScore) > 0) bestScore = score;
          }
        }
      }
    }
  }
  return { score: bestScore, name: HAND_NAMES[bestScore[0]] };
}

function nextActiveIndex(game, fromIndex) {
  for (let step = 1; step <= game.players.length; step++) {
    const index = (fromIndex + step) % game.players.length;
    if (!game.players[index].folded) return index;
  }
  return -1;
}

function draw(game) {
  const card = game.deck.pop();
  if (!card) throw new Error("No quedan cartas en el mazo.");
  return card;
}

function postBlind(game, player, amount) {
  const paid = Math.min(player.stack, amount);
  player.stack -= paid;
  player.streetBet += paid;
  game.pot += paid;
}

function beginHand(players, dealerIndex) {
  if (players.length < 2 || players.length > MAX_PLAYERS) {
    throw new Error("Se necesitan entre dos y cuatro jugadores para iniciar.");
  }
  const wallets = players.map((player) => player.wallet.toLowerCase());
  if (new Set(wallets).size !== wallets.length) {
    throw new Error("No puede haber billeteras duplicadas en la mesa.");
  }
  if (players.some((player) => !Number.isSafeInteger(player.stack) || player.stack <= 0)) {
    throw new Error("Todos los jugadores deben tener fichas para jugar.");
  }

  const game = {
    players: players.map(({ wallet, stack }) => ({
      wallet: wallet.toLowerCase(),
      stack,
      folded: false,
      streetBet: 0,
      holeCards: []
    })),
    deck: createDeck(),
    board: [],
    pot: 0,
    phase: "preflop",
    currentBet: BIG_BLIND,
    minRaise: BIG_BLIND,
    dealerIndex: dealerIndex % players.length,
    currentPlayerIndex: 0,
    acted: new Set(),
    winners: []
  };

  const smallBlindIndex = players.length === 2
    ? game.dealerIndex
    : (game.dealerIndex + 1) % players.length;
  const bigBlindIndex = (smallBlindIndex + 1) % players.length;
  postBlind(game, game.players[smallBlindIndex], SMALL_BLIND);
  postBlind(game, game.players[bigBlindIndex], BIG_BLIND);
  for (let card = 0; card < 2; card++) {
    for (let step = 1; step <= players.length; step++) {
      game.players[(game.dealerIndex + step) % players.length].holeCards.push(draw(game));
    }
  }
  game.currentBet = Math.max(...game.players.map((player) => player.streetBet));
  game.currentPlayerIndex = players.length === 2
    ? game.dealerIndex
    : (bigBlindIndex + 1) % players.length;
  return game;
}

export function createGame(players) {
  if (!Array.isArray(players)) throw new Error("La lista de jugadores no es válida.");
  return beginHand(players.map((player) => typeof player === "string"
    ? { wallet: player, stack: STARTING_STACK }
    : { wallet: player.wallet, stack: player.stack }
  ), 0);
}

function finishHand(game, winners) {
  const share = Math.floor(game.pot / winners.length);
  let remainder = game.pot - share * winners.length;
  for (const winner of winners) {
    const player = game.players.find((entry) => entry.wallet === winner.wallet);
    player.stack += share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  game.winners = winners;
  game.pot = 0;
  game.phase = "complete";
  game.currentPlayerIndex = -1;
}

function showdown(game) {
  const contenders = game.players.filter((player) => !player.folded);
  const ranked = contenders.map((player) => ({
    wallet: player.wallet,
    hand: evaluateHand([...player.holeCards, ...game.board])
  }));
  let best = ranked[0].hand.score;
  for (const candidate of ranked.slice(1)) {
    if (compareScores(candidate.hand.score, best) > 0) best = candidate.hand.score;
  }
  const winners = ranked
    .filter((candidate) => compareScores(candidate.hand.score, best) === 0)
    .map(({ wallet, hand }) => ({ wallet, hand: hand.name }));
  finishHand(game, winners);
}

function advanceStreet(game) {
  if (game.phase === "river") {
    showdown(game);
    return;
  }
  const streetIndex = STREET_ORDER.indexOf(game.phase);
  game.phase = STREET_ORDER[streetIndex + 1];
  game.players.forEach((player) => { player.streetBet = 0; });
  game.currentBet = 0;
  game.minRaise = BIG_BLIND;
  game.acted.clear();
  if (game.phase === "flop") {
    draw(game);
    game.board.push(draw(game), draw(game), draw(game));
  } else {
    draw(game);
    game.board.push(draw(game));
  }
  game.currentPlayerIndex = nextActiveIndex(game, game.dealerIndex);
}

function closeRoundIfReady(game) {
  if (game.players.filter((player) => !player.folded).length === 1) {
    const winner = game.players.find((player) => !player.folded);
    finishHand(game, [{ wallet: winner.wallet, hand: null }]);
    return;
  }
  const roundComplete = game.players.every((player) =>
    player.folded || (game.acted.has(player.wallet) && player.streetBet === game.currentBet)
  );
  if (roundComplete) {
    advanceStreet(game);
    return;
  }
  game.currentPlayerIndex = nextActiveIndex(game, game.currentPlayerIndex);
}

export function applyAction(game, wallet, action) {
  if (game.phase === "complete") throw new Error("La mano ya terminó.");
  const player = game.players.find((entry) => entry.wallet === wallet.toLowerCase());
  if (!player || player.folded) throw new Error("No estás participando en esta mano.");
  if (game.players[game.currentPlayerIndex]?.wallet !== player.wallet) {
    throw new Error("No es tu turno.");
  }
  if (!action || typeof action.type !== "string") throw new Error("La acción no es válida.");

  const type = action.type.toLowerCase();
  const owed = game.currentBet - player.streetBet;
  if (type === "fold") {
    player.folded = true;
  } else if (type === "check") {
    if (owed > 0) throw new Error("No puedes pasar: debes igualar la apuesta.");
    game.acted.add(player.wallet);
  } else if (type === "call") {
    if (owed <= 0) throw new Error("No hay apuesta que igualar; puedes pasar.");
    if (player.stack < owed) throw new Error("No tienes fichas suficientes para igualar.");
    player.stack -= owed;
    player.streetBet += owed;
    game.pot += owed;
    game.acted.add(player.wallet);
  } else if (type === "raise") {
    const raiseBy = Number(action.amount);
    if (!Number.isSafeInteger(raiseBy) || raiseBy < game.minRaise) {
      throw new Error(`La subida mínima es de ${game.minRaise} fichas.`);
    }
    const totalCost = owed + raiseBy;
    if (player.stack < totalCost) throw new Error("No tienes fichas suficientes para subir.");
    player.stack -= totalCost;
    player.streetBet += totalCost;
    game.pot += totalCost;
    game.currentBet = player.streetBet;
    game.minRaise = raiseBy;
    game.acted.clear();
    game.acted.add(player.wallet);
  } else {
    throw new Error("Acción no válida. Usa fold, check, call o raise.");
  }

  closeRoundIfReady(game);
  return game;
}

export function startNextHand(game) {
  if (game.phase !== "complete") throw new Error("La mano actual todavía no termina.");
  const players = game.players
    .filter((player) => player.stack > 0)
    .map(({ wallet, stack }) => ({ wallet, stack }));
  if (players.length < 2) throw new Error("No quedan dos jugadores con fichas.");
  return beginHand(players, (game.dealerIndex + 1) % players.length);
}

export function getPublicState(game) {
  const completed = game.phase === "complete";
  return {
    phase: game.phase,
    pot: game.pot,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    board: game.board,
    turn: game.players[game.currentPlayerIndex]?.wallet ?? null,
    dealer: game.players[game.dealerIndex]?.wallet ?? null,
    players: game.players.map((player) => ({
      wallet: player.wallet,
      stack: player.stack,
      folded: player.folded,
      streetBet: player.streetBet,
      ...(completed ? { holeCards: player.holeCards } : {})
    })),
    winners: game.winners
  };
}

export function getPrivateState(game, wallet) {
  const player = game.players.find((entry) => entry.wallet === wallet.toLowerCase());
  return player ? { wallet: player.wallet, holeCards: player.holeCards } : null;
}
