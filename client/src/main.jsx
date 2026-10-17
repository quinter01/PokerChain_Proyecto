import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import { BrowserProvider, Contract } from "ethers";
import { normalizeTableState } from "./tableState.js";
import "./style.css";

const ABI = [
  "function joinTable(uint8 targetPlayerCount) payable",
  "function buyIn() view returns (uint256)",
  "function playerCount() view returns (uint8)",
  "function potBalance() view returns (uint256)",
  "function getPlayers() view returns (address[4])",
  "function settle(address winner)"
];
const CONTRACT_ADDRESS = import.meta.env.VITE_POKER_CONTRACT_ADDRESS;
const SOCKET_URL = import.meta.env.VITE_GAME_SERVER_URL
  || `${window.location.protocol}//${window.location.hostname}:3001`;

function cardLabel(card) {
  const rank = ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[card.rank] ?? card.rank;
  const suit = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[card.suit];
  return `${rank}${suit}`;
}

function App() {
  const socketRef = useRef(null);
  const tablePlayersRef = useRef([]);
  const [wallet, setWallet] = useState("");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("poker-player-name") ?? "");
  const [status, setStatus] = useState("Conecta MetaMask para comenzar.");
  const [tableState, setTableState] = useState({ players: [], seatsTaken: 0, maxPlayers: 4 });
  const [selectedPlayerCount, setSelectedPlayerCount] = useState(4);
  const [gameState, setGameState] = useState(null);
  const [privateState, setPrivateState] = useState(null);
  const [tableId, setTableId] = useState("1");
  const [actionLog, setActionLog] = useState([]);
  const [contract, setContract] = useState(null);
  tablePlayersRef.current = tableState.players;

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;
    socket.on("server:message", (m) => setStatus(m.text));
    socket.on("table:state", (state) => {
      try {
        const normalizedState = normalizeTableState(state);
        setTableState(normalizedState);
        setSelectedPlayerCount((current) =>
          normalizedState.configured ? normalizedState.maxPlayers : current
        );
      } catch (error) {
        setStatus(error.message);
      }
    });
    socket.on("game:state", (state) => {
      setGameState(state);
      setTableState((current) => ({ ...current, started: true }));
    });
    socket.on("game:private", setPrivateState);
    socket.on("game:action", (m) => setActionLog((old) => [
      `${getPlayerName(m.player)}: ${m.action.type}${m.action.amount ? ` ${m.action.amount}` : ""}`,
      ...old
    ].slice(0, 8)));
    socket.on("game:error", (e) => setStatus(e.message));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  function getPlayerName(address) {
    return tablePlayersRef.current.find((player) =>
      player.walletAddress.toLowerCase() === address?.toLowerCase()
    )?.playerName ?? `${address?.slice(0, 6)}…`;
  }

  async function connectWallet() {
    try {
      if (!window.ethereum) throw new Error("Instala MetaMask para conectar una billetera.");
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setWallet(address);
      if (CONTRACT_ADDRESS) setContract(new Contract(CONTRACT_ADDRESS, ABI, signer));
      setStatus("Billetera conectada. Entra a la mesa para aparecer en la sala.");
    } catch (e) { setStatus(e.shortMessage || e.message); }
  }

  function joinRealtimeTable() {
    if (!wallet) return setStatus("Conecta la billetera primero.");
    const normalizedName = playerName.trim();
    if (!normalizedName) return setStatus("Escribe un nombre para unirte a la sala.");
    if (normalizedName.length > 20) return setStatus("El nombre debe tener 20 caracteres o menos.");
    localStorage.setItem("poker-player-name", normalizedName);
    const socket = socketRef.current;
    if (!socket) return setStatus("No hay conexión con el servidor de juego.");
    const join = () => socket.emit("table:join", {
      tableId,
      walletAddress: wallet,
      playerName: normalizedName,
      maxPlayers: selectedPlayerCount
    });
    if (socket.connected) join();
    else socket.once("connect", join);
    setStatus("Solicitud de entrada enviada al servidor de juego.");
  }

  function configureTableSize(count) {
    if (isViewingJoinedTable && count < tableState.seatsTaken) {
      setStatus(`Ya hay ${tableState.seatsTaken} jugadores; elige esa cantidad o más.`);
      return;
    }
    setSelectedPlayerCount(count);
    if (alreadyInSelectedTable && !tableHasStarted) {
      socketRef.current?.emit("table:configure", { tableId, maxPlayers: count });
    }
  }

  async function depositBuyIn() {
    try {
      if (!contract) throw new Error("Configura VITE_POKER_CONTRACT_ADDRESS y vuelve a cargar.");
      const tx = await contract.joinTable(selectedPlayerCount, {
        value: await contract.buyIn()
      });
      setStatus("Transacción enviada. Esperando confirmación...");
      await tx.wait();
      setStatus("Buy-in confirmado en blockchain.");
    } catch (e) { setStatus(e.shortMessage || e.message); }
  }

  function sendAction(type) {
    const socket = socketRef.current;
    if (!socket?.connected) return setStatus("No hay conexión con el servidor de juego.");
    const action = type === "raise"
      ? { type, amount: gameState?.minRaise ?? 20 }
      : { type };
    socket.emit("game:action", { tableId, action });
  }

  function requestNextHand() {
    socketRef.current?.emit("game:nextHand", { tableId });
  }

  function requestNewGame() {
    socketRef.current?.emit("game:resetLobby", { tableId });
  }

  function startGame() {
    socketRef.current?.emit("game:start", { tableId });
  }

  const myPlayer = gameState?.players.find((player) =>
    player.wallet.toLowerCase() === wallet.toLowerCase()
  );
  const isMyTurn = gameState?.turn?.toLowerCase() === wallet.toLowerCase();
  const amountToCall = myPlayer ? Math.max(0, gameState.currentBet - myPlayer.streetBet) : 0;
  const visibleCards = privateState?.wallet?.toLowerCase() === wallet.toLowerCase()
    ? privateState.holeCards
    : [];
  const isViewingJoinedTable = String(tableState.tableId) === String(tableId);
  const alreadyInSelectedTable = isViewingJoinedTable
    && tableState.players.some((player) => player.walletAddress.toLowerCase() === wallet.toLowerCase());
  const isHost = alreadyInSelectedTable
    && tableState.hostAddress?.toLowerCase() === wallet.toLowerCase();
  const tableIsFull = isViewingJoinedTable && tableState.configured
    && tableState.seatsTaken >= tableState.maxPlayers;
  const tableHasStarted = isViewingJoinedTable && tableState.started;
  const currentGameState = tableHasStarted ? gameState : null;
  const winners = currentGameState?.winners ?? [];
  const winnerMessage = winners.length > 1
    ? `¡Empate! ${winners.map((winner) => getPlayerName(winner.wallet)).join(", ")} comparten el bote${winners[0].hand ? ` con ${winners[0].hand}` : ""}.`
    : winners.length === 1
      ? winners[0].hand
        ? `¡${getPlayerName(winners[0].wallet)} gana con ${winners[0].hand}!`
        : `¡${getPlayerName(winners[0].wallet)} gana porque los demás jugadores se retiraron!`
      : "";

  return <main className="shell">
    <header><div><span className="eyebrow">WEB3 · TEXAS HOLD'EM</span><h1>PokerChain</h1><p>Póker para 2 a 4 jugadores</p></div>
      <button onClick={connectWallet}>{wallet ? "Billetera conectada" : "Conectar MetaMask"}</button>
    </header>
    <div className="status">{status}</div>
    <section className="layout">
      <div className="table-panel">
        <div className="table-top"><span>MESA #{tableId}</span><span>{tableState.seatsTaken}/{tableState.maxPlayers} jugadores conectados</span></div>
        <div className="poker-table">
          <div className="pot">BOTE<strong>{currentGameState?.pot ?? 0} fichas · {currentGameState?.phase ?? "esperando jugadores"}</strong></div>
          <div className="cards">
            {Array.from({ length: 5 }, (_, i) => currentGameState?.board[i]
              ? <span key={i}>{cardLabel(currentGameState.board[i])}</span>
              : <span key={i}>🂠</span>)}
          </div>
          <p>{currentGameState?.turn ? `Turno: ${getPlayerName(currentGameState.turn)}` : tableIsFull && !tableHasStarted
            ? "Mesa completa. Un jugador puede iniciar la partida."
            : `Esperando ${tableState.maxPlayers} jugadores…`}</p>
          {isHost && <span className="host-badge">HOST DE LA SALA</span>}
          {winnerMessage && <div className="winner-announcement" role="status">{winnerMessage}</div>}
          <div className="seats">{Array.from({ length: tableState.maxPlayers }, (_, i) => {
            const seatedPlayer = tableState.players[i];
            const address = seatedPlayer?.walletAddress;
            const player = currentGameState?.players.find((entry) =>
              entry.wallet.toLowerCase() === address?.toLowerCase()
            );
            return <div className="seat" key={i}>
              <span className="seat-icon">♙</span>
              <span>{seatedPlayer ? `${seatedPlayer.playerName}${player ? ` · ${player.stack} fichas${player.folded ? " · fold" : ""}` : ""}` : `Asiento ${i+1}`}</span>
            </div>;
          })}</div>
          {visibleCards.length > 0 && <p>Tus cartas: {visibleCards.map(cardLabel).join(" ")}</p>}
        </div>
        <div className="actions">
          {!tableHasStarted
            ? tableIsFull && alreadyInSelectedTable
              ? isHost
                ? <button onClick={startGame}>INICIAR PARTIDA</button>
                : <span className="hint">El host iniciará la partida cuando esté listo.</span>
              : <span className="hint">La partida comenzará cuando se ocupen todos los asientos.</span>
            : currentGameState?.phase === "complete"
            ? <>
              {isHost && <>
                <button onClick={requestNextHand}>NUEVA MANO</button>
                <button className="secondary" onClick={requestNewGame}>NUEVA PARTIDA</button>
              </>}
              {!isHost && <span className="hint">El host decide cuándo continuar o iniciar otra partida.</span>}
            </>
            : ["fold", amountToCall > 0 ? "call" : "check", "raise"].map((action) =>
              <button
                className={action === "fold" ? "danger" : ""}
                disabled={!isMyTurn || !currentGameState}
                key={action}
                onClick={() => sendAction(action)}
              >
                {action === "raise" ? `RAISE +${currentGameState?.minRaise ?? 20}` : action.toUpperCase()}
              </button>
            )}
        </div>
      </div>
      <aside>
        <section className="panel"><h2>Entrar a la mesa</h2><label>Nombre de jugador</label><input value={playerName} maxLength={20} onChange={(e) => setPlayerName(e.target.value)} placeholder="Ej. Reina del póker" />
          <label>ID de mesa</label><input value={tableId} onChange={(e) => setTableId(e.target.value)} />
          <label>Número de jugadores</label>
          <div className="actions player-count" role="group" aria-label="Número de jugadores">
            {[2, 3, 4].map((count) => <button
              aria-pressed={selectedPlayerCount === count}
              disabled={tableHasStarted || (alreadyInSelectedTable && !isHost)}
              key={count}
              className={selectedPlayerCount === count ? "selected" : "secondary"}
              onClick={() => configureTableSize(count)}
            >{count}</button>)}
          </div>
          <button className="full" onClick={joinRealtimeTable}>Conectar a sala en tiempo real</button>
          <button className="full secondary" onClick={depositBuyIn}>Depositar buy-in (MON de prueba)</button>
          <p className="hint">El buy-in usa la moneda nativa de la red conectada. Usa solo MON de prueba en una red local configurada para la demo.</p>
        </section>
        <section className="panel"><h2>Actividad</h2>{actionLog.length ? actionLog.map((a,i)=><p className="log" key={i}>{a}</p>) : <p className="hint">Las acciones aparecerán aquí.</p>}</section>
      </aside>
    </section>
    <footer>Prototipo académico · Partida y fichas simuladas en el servidor · No usar con fondos reales</footer>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);