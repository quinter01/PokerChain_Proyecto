export function normalizeTableState(state) {
  if (!state || !Array.isArray(state.players)) {
    throw new Error("El servidor envió un estado de sala no válido.");
  }

  const players = state.players.map((player, index) => {
    if (typeof player === "string") {
      return {
        walletAddress: player,
        playerName: `Jugador ${index + 1}`,
        paid: true,
        chips: 1000
      };
    }
    if (!player || typeof player.walletAddress !== "string") {
      throw new Error("El servidor envió un jugador sin billetera válida.");
    }
    return {
      walletAddress: player.walletAddress,
      playerName: typeof player.playerName === "string" && player.playerName.trim()
        ? player.playerName
        : `Jugador ${index + 1}`,
      paid: typeof player.paid === "boolean" ? player.paid : true,
      chips: Number.isSafeInteger(player.chips) ? player.chips : 1000
    };
  });

  return {
    tableId: state.tableId == null ? "" : String(state.tableId),
    players,
    seatsTaken: Number.isInteger(state.seatsTaken) ? state.seatsTaken : players.length,
    maxPlayers: Number.isInteger(state.maxPlayers) ? state.maxPlayers : 4,
    depositCount: Number.isInteger(state.depositCount)
      ? state.depositCount
      : players.filter((player) => player.paid).length,
    configured: typeof state.configured === "boolean" ? state.configured : players.length > 0,
    started: typeof state.started === "boolean" ? state.started : false,
    hostAddress: typeof state.hostAddress === "string" ? state.hostAddress : null,
    closed: typeof state.closed === "boolean" ? state.closed : false,
    settlement: state.settlement && Array.isArray(state.settlement.players)
      ? state.settlement
      : null
  };
}
