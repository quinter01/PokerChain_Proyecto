import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import { BrowserProvider, Contract, formatEther } from "ethers";
import { normalizeTableState } from "./tableState.js";
import "./style.css";

const ABI = [
  "function joinTable(uint8 targetPlayerCount) payable",
  "function leaveTableAndRefund()",
  "function lockGame()",
  "function gameStarted() view returns (bool)",
  "function playerCount() view returns (uint8)",
  "function potBalance() view returns (uint256)",
  "function getPlayers() view returns (address[4])",
  "function owner() view returns (address)",
  "function payoutsFinalized() view returns (bool)",
  "function claimable(address) view returns (uint256)",
  "function adminFee() view returns (uint256)",
  "function finalizePayouts(uint256[4] finalChips)",
  "function claimPayout()",
  "function withdrawAdminFee()"
];
const CONTRACT_ADDRESS = import.meta.env.VITE_POKER_CONTRACT_ADDRESS;
const MONAD_TESTNET_CHAIN_ID = 10143n;
const SOCKET_URL = import.meta.env.VITE_GAME_SERVER_URL
  || `${window.location.protocol}//${window.location.hostname}:3001`;

async function requireMonadTestnet(provider) {
  const network = await provider.getNetwork();
  if (network.chainId !== MONAD_TESTNET_CHAIN_ID) {
    throw new Error("Cambia MetaMask a Monad Testnet (Chain ID 10143) para usar el contrato.");
  }
}

function cardLabel(card) {
  const rank = ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[card.rank] ?? card.rank;
  const suit = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[card.suit];
  return `${rank}${suit}`;
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error("El servidor no respondió a tiempo. Inténtalo de nuevo."));
      } else if (!response?.ok) {
        reject(new Error(response?.message ?? "El servidor rechazó la solicitud."));
      } else {
        resolve(response);
      }
    });
  });
}

function readPendingBuyIn() {
  try {
    const pending = JSON.parse(localStorage.getItem("poker-pending-buy-in") ?? "null");
    if (pending && typeof pending.walletAddress === "string"
      && typeof pending.tableId === "string"
      && Number.isInteger(pending.playerCount)
      && /^0x[a-fA-F0-9]{64}$/.test(pending.transactionHash)) {
      return pending;
    }
  } catch {
    localStorage.removeItem("poker-pending-buy-in");
  }
  return null;
}

function readPendingRefund() {
  try {
    const pending = JSON.parse(localStorage.getItem("poker-pending-refund") ?? "null");
    if (pending && typeof pending.walletAddress === "string"
      && typeof pending.tableId === "string"
      && /^0x[a-fA-F0-9]{64}$/.test(pending.transactionHash)) {
      return pending;
    }
  } catch {
    localStorage.removeItem("poker-pending-refund");
  }
  return null;
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
  const [pendingBuyIn, setPendingBuyIn] = useState(readPendingBuyIn);
  const [pendingRefund, setPendingRefund] = useState(readPendingRefund);
  const [gameLocking, setGameLocking] = useState(false);
  const [refundPending, setRefundPending] = useState(false);
  const [payoutStatus, setPayoutStatus] = useState({
    owner: "",
    finalized: false,
    claimable: "0",
    adminFee: "0"
  });
  const [showInstructions, setShowInstructions] = useState(false);
  const closeInstructionsRef = useRef(null);
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

  useEffect(() => {
    if (tableState.closed && String(tableState.tableId) === String(tableId) && wallet) {
      refreshPayoutStatus().catch((error) => setStatus(error.shortMessage || error.message));
    }
  }, [tableState.closed, tableState.tableId, tableId, wallet]);

  useEffect(() => {
    if (!showInstructions) return undefined;
    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setShowInstructions(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    closeInstructionsRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [showInstructions]);

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
      await requireMonadTestnet(provider);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setWallet(address);
      setStatus("Billetera conectada. Entra a la mesa para aparecer en la sala.");
    } catch (e) { setStatus(e.shortMessage || e.message); }
  }

  async function joinRealtimeTable() {
    if (!wallet) return setStatus("Conecta la billetera primero.");
    const normalizedName = playerName.trim();
    if (!normalizedName) return setStatus("Escribe un nombre para unirte a la sala.");
    if (normalizedName.length > 20) return setStatus("El nombre debe tener 20 caracteres o menos.");
    if (!CONTRACT_ADDRESS) {
      return setStatus("No hay contrato desplegado. Configura VITE_POKER_CONTRACT_ADDRESS en client/.env.");
    }
    localStorage.setItem("poker-player-name", normalizedName);
    const socket = socketRef.current;
    if (!socket) return setStatus("No hay conexión con el servidor de juego.");
    let reservationCreated = false;
    let transactionSubmitted = false;
    try {
      const provider = new BrowserProvider(window.ethereum);
      await requireMonadTestnet(provider);
      const signer = await provider.getSigner();
      const walletAddress = await signer.getAddress();
      if (walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        setWallet(walletAddress);
      }
      const savedBuyIn = pendingBuyIn
        && pendingBuyIn.walletAddress.toLowerCase() === walletAddress.toLowerCase()
        ? pendingBuyIn
        : null;
      if (savedBuyIn && (savedBuyIn.tableId !== String(tableId)
        || savedBuyIn.playerCount !== selectedPlayerCount)) {
        throw new Error("Ya tienes un buy-in confirmado pendiente para otra mesa o capacidad; vuelve a usar esos datos.");
      }
      if (!socket.connected) {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            socket.off("connect", onConnect);
            socket.off("connect_error", onError);
          };
          const onConnect = () => {
            cleanup();
            resolve();
          };
          const onError = (error) => {
            cleanup();
            reject(error);
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("No se pudo conectar con el servidor de juego."));
          }, 10000);
          socket.once("connect", onConnect);
          socket.once("connect_error", onError);
          socket.connect();
        });
      }
      const { message } = await emitWithAck(socket, "wallet:challenge", { walletAddress });
      const signature = await signer.signMessage(message);
      await emitWithAck(socket, "wallet:authenticate", { signature });
      const reservation = await emitWithAck(socket, "table:reserve", {
        tableId,
        playerName: normalizedName,
        maxPlayers: selectedPlayerCount
      });
      if (reservation.alreadyPaid) {
        setPendingBuyIn(null);
        localStorage.removeItem("poker-pending-buy-in");
        setStatus(`Buy-in confirmado: ${reservation.chips} fichas disponibles.`);
        return;
      }
      reservationCreated = true;

      let transactionHash = savedBuyIn?.transactionHash;
      if (!transactionHash) {
        const signerContract = new Contract(CONTRACT_ADDRESS, ABI, signer);
        const value = BigInt(reservation.buyInWei);
        setStatus("Confirma el buy-in de 0.01 MON en MetaMask...");
        const transaction = await signerContract.joinTable(selectedPlayerCount, { value });
        transactionSubmitted = true;
        transactionHash = transaction.hash;
        const pending = {
          walletAddress,
          tableId: String(tableId),
          playerCount: selectedPlayerCount,
          transactionHash
        };
        setPendingBuyIn(pending);
        localStorage.setItem("poker-pending-buy-in", JSON.stringify(pending));
        setStatus("Transacción enviada. Esperando confirmación en Monad Testnet...");
        await transaction.wait();
      } else {
        transactionSubmitted = true;
        setStatus("Reintentando verificar tu buy-in confirmado...");
      }
      const { chips } = await emitWithAck(socket, "buyin:verify", {
        tableId,
        transactionHash
      });
      setPendingBuyIn(null);
      localStorage.removeItem("poker-pending-buy-in");
      setStatus(`Buy-in confirmado: recibiste ${chips} fichas.`);
    } catch (error) {
      if (reservationCreated && !transactionSubmitted) {
        socket.emit("table:cancelReservation", { tableId });
      }
      setStatus(error.shortMessage || error.message);
    }
  }

  async function watchClosedSettlement() {
    if (!wallet) return setStatus("Conecta la wallet para consultar los retiros.");
    const socket = socketRef.current;
    if (!socket) return setStatus("No hay conexión con el servidor de juego.");
    try {
      const provider = new BrowserProvider(window.ethereum);
      await requireMonadTestnet(provider);
      const signer = await provider.getSigner();
      const walletAddress = await signer.getAddress();
      setWallet(walletAddress);
      if (!socket.connected) {
        await new Promise((resolve, reject) => {
          const onConnect = () => {
            clearTimeout(timer);
            socket.off("connect_error", onError);
            resolve();
          };
          const onError = (error) => {
            clearTimeout(timer);
            socket.off("connect", onConnect);
            reject(error);
          };
          const timer = setTimeout(() => {
            socket.off("connect", onConnect);
            socket.off("connect_error", onError);
            reject(new Error("No se pudo conectar con el servidor de juego."));
          }, 10000);
          socket.once("connect", onConnect);
          socket.once("connect_error", onError);
          socket.connect();
        });
      }
      const { message } = await emitWithAck(socket, "wallet:challenge", { walletAddress });
      await emitWithAck(socket, "wallet:authenticate", {
        signature: await signer.signMessage(message)
      });
      await emitWithAck(socket, "table:watch", { tableId });
      setStatus("Distribución de la partida cargada.");
    } catch (error) {
      setStatus(error.shortMessage || error.message);
    }
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

  async function startGame() {
    if (gameLocking) return;
    setGameLocking(true);
    try {
      if (!window.ethereum) throw new Error("Instala MetaMask para iniciar la partida.");
      if (!CONTRACT_ADDRESS) throw new Error("No hay contrato de Monad configurado en client/.env.");
      const socket = socketRef.current;
      if (!socket?.connected) throw new Error("No hay conexión con el servidor de juego.");
      await emitWithAck(socket, "game:validateStart", { tableId });
      const provider = new BrowserProvider(window.ethereum);
      await requireMonadTestnet(provider);
      const signer = await provider.getSigner();
      const walletAddress = await signer.getAddress();
      if (walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("Conecta la wallet host de esta mesa para iniciar la partida.");
      }
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      if (!await contract.gameStarted()) {
        setStatus("Bloqueando la mesa en Monad Testnet...");
        const transaction = await contract.lockGame();
        await transaction.wait();
      }
      await emitWithAck(socket, "game:start", { tableId });
      setStatus("Mesa bloqueada. ¡Que comience la partida!");
    } catch (error) {
      setStatus(error.shortMessage || error.message);
    } finally {
      setGameLocking(false);
    }
  }

  async function leaveTableAndRefund() {
    if (refundPending) return;
    setRefundPending(true);
    let savedRefund;
    try {
      if (!window.ethereum) throw new Error("Instala MetaMask para solicitar el reembolso.");
      if (!CONTRACT_ADDRESS) throw new Error("No hay contrato de Monad configurado en client/.env.");
      const provider = new BrowserProvider(window.ethereum);
      await requireMonadTestnet(provider);
      const signer = await provider.getSigner();
      const walletAddress = await signer.getAddress();
      if (walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("Conecta la misma wallet con la que pagaste el buy-in.");
      }
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      if (pendingRefund
        && (pendingRefund.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
          || pendingRefund.tableId !== String(tableId))) {
        throw new Error("Hay un reembolso pendiente de sincronizar para otra wallet o mesa; recupéralo primero.");
      }
      savedRefund = pendingRefund
        && pendingRefund.walletAddress.toLowerCase() === walletAddress.toLowerCase()
        && pendingRefund.tableId === String(tableId)
        ? pendingRefund
        : null;
      let transactionHash = savedRefund?.transactionHash;
      if (!transactionHash) {
        setStatus("Confirma en MetaMask el reembolso de 0.01 MON...");
        const transaction = await contract.leaveTableAndRefund();
        transactionHash = transaction.hash;
        savedRefund = { walletAddress, tableId: String(tableId), transactionHash };
        setPendingRefund(savedRefund);
        localStorage.setItem("poker-pending-refund", JSON.stringify(savedRefund));
      } else {
        setStatus("Reintentando sincronizar el reembolso confirmado...");
      }
      const receipt = await provider.getTransactionReceipt(transactionHash)
        ?? await provider.waitForTransaction(transactionHash);
      if (!receipt || receipt.status !== 1) {
        setPendingRefund(null);
        localStorage.removeItem("poker-pending-refund");
        throw new Error("La transacción de reembolso no se confirmó correctamente.");
      }

      const socket = socketRef.current;
      if (!socket) throw new Error("No hay conexión con el servidor de juego.");
      if (!socket.connected) {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            socket.off("connect", onConnect);
            socket.off("connect_error", onError);
          };
          const onConnect = () => {
            cleanup();
            resolve();
          };
          const onError = (error) => {
            cleanup();
            reject(error);
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("No se pudo conectar con el servidor de juego."));
          }, 10000);
          socket.once("connect", onConnect);
          socket.once("connect_error", onError);
          socket.connect();
        });
      }
      const { message } = await emitWithAck(socket, "wallet:challenge", { walletAddress });
      await emitWithAck(socket, "wallet:authenticate", {
        signature: await signer.signMessage(message)
      });
      await emitWithAck(socket, "buyin:refund", { tableId, transactionHash });
      setPendingRefund(null);
      localStorage.removeItem("poker-pending-refund");
      setStatus("Buy-in reembolsado a tu wallet en Monad Testnet. El asiento quedó libre.");
    } catch (error) {
      setStatus(error.shortMessage || error.message);
    } finally {
      setRefundPending(false);
    }
  }

  function closeGameForWithdrawals() {
    socketRef.current?.emit("game:close", { tableId });
  }

  async function getPayoutContract() {
    if (!window.ethereum) throw new Error("Instala MetaMask para retirar fondos.");
    if (!CONTRACT_ADDRESS) throw new Error("No hay contrato de Monad configurado en client/.env.");
    const provider = new BrowserProvider(window.ethereum);
    await requireMonadTestnet(provider);
    const signer = await provider.getSigner();
    return {
      signer,
      contract: new Contract(CONTRACT_ADDRESS, ABI, signer),
      walletAddress: await signer.getAddress()
    };
  }

  async function refreshPayoutStatus() {
    const { contract, walletAddress } = await getPayoutContract();
    const ownerAddress = await contract.owner();
    const finalized = await contract.payoutsFinalized();
    const playerClaimable = await contract.claimable(walletAddress);
    const adminFee = await contract.adminFee();
    setPayoutStatus({
      owner: ownerAddress,
      finalized,
      claimable: playerClaimable.toString(),
      adminFee: adminFee.toString()
    });
  }

  async function finalizePayouts() {
    try {
      const settlement = tableState.settlement;
      if (!settlement) throw new Error("El servidor no envió los saldos finales de esta partida.");
      const { contract, walletAddress } = await getPayoutContract();
      const ownerAddress = await contract.owner();
      if (ownerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error("Solo el owner del contrato puede confirmar los saldos finales.");
      }
      const onChainPlayers = await contract.getPlayers();
      const finalChips = onChainPlayers.map((onChainPlayer) => {
        if (onChainPlayer === "0x0000000000000000000000000000000000000000") return 0;
        const player = settlement.players.find((entry) =>
          entry.walletAddress.toLowerCase() === onChainPlayer.toLowerCase()
        );
        if (!player) {
          throw new Error("Los jugadores de la partida no coinciden con los depósitos del contrato.");
        }
        return player.finalChips;
      });
      const registeredPlayers = onChainPlayers.filter((address) =>
        address !== "0x0000000000000000000000000000000000000000"
      );
      if (settlement.players.length !== registeredPlayers.length) {
        throw new Error("La partida no incluye a todos los participantes registrados en el contrato.");
      }
      const transaction = await contract.finalizePayouts(finalChips);
      setStatus("Distribución enviada a Monad. Esperando confirmación...");
      await transaction.wait();
      await refreshPayoutStatus();
      setStatus("Distribución confirmada. Cada jugador puede retirar sus MON.");
    } catch (error) {
      setStatus(error.shortMessage || error.message);
    }
  }

  async function claimPayout() {
    try {
      const { contract, walletAddress } = await getPayoutContract();
      const amount = await contract.claimable(walletAddress);
      if (amount === 0n) throw new Error("Tu wallet no tiene un retiro pendiente en esta partida.");
      const transaction = await contract.claimPayout();
      setStatus("Retiro enviado a Monad. Esperando confirmación...");
      await transaction.wait();
      await refreshPayoutStatus();
      setStatus(`Retiro recibido en tu wallet: ${formatEther(amount)} MON.`);
    } catch (error) {
      setStatus(error.shortMessage || error.message);
    }
  }

  async function withdrawAdminFee() {
    try {
      const { contract, walletAddress } = await getPayoutContract();
      const ownerAddress = await contract.owner();
      if (ownerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error("Solo el owner del contrato puede retirar la comisión.");
      }
      const amount = await contract.adminFee();
      if (amount === 0n) throw new Error("No hay comisión pendiente para retirar.");
      const transaction = await contract.withdrawAdminFee();
      setStatus("Retiro de comisión enviado a Monad. Esperando confirmación...");
      await transaction.wait();
      await refreshPayoutStatus();
      setStatus(`Comisión retirada a la wallet administradora: ${formatEther(amount)} MON.`);
    } catch (error) {
      setStatus(error.shortMessage || error.message);
    }
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
  const selectedTablePlayer = tableState.players.find((player) =>
    player.walletAddress.toLowerCase() === wallet.toLowerCase()
  );
  const pendingRefundForTable = pendingRefund
    && pendingRefund.walletAddress.toLowerCase() === wallet.toLowerCase()
    && pendingRefund.tableId === String(tableId);
  const isHost = alreadyInSelectedTable
    && tableState.hostAddress?.toLowerCase() === wallet.toLowerCase();
  const tableIsClosed = isViewingJoinedTable && tableState.closed;
  const tableHasPaidSeats = isViewingJoinedTable
    && tableState.depositCount === tableState.maxPlayers;
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
      <div className="header-actions">
        <button className="secondary" onClick={() => setShowInstructions(true)}>INSTRUCCIONES</button>
        <button onClick={connectWallet}>{wallet ? "Billetera conectada" : "Conectar MetaMask"}</button>
      </div>
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
          <p>{currentGameState?.turn ? `Turno: ${getPlayerName(currentGameState.turn)}` : tableHasPaidSeats && !tableHasStarted
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
              <span>{seatedPlayer
                ? `${seatedPlayer.playerName}${seatedPlayer.paid === false ? " · buy-in pendiente" : player ? ` · ${player.stack} fichas${player.folded ? " · fold" : ""}` : ` · ${seatedPlayer.chips} fichas`}`
                : `Asiento ${i+1}`}</span>
            </div>;
          })}</div>
          {visibleCards.length > 0 && <p>Tus cartas: {visibleCards.map(cardLabel).join(" ")}</p>}
        </div>
        <div className="actions">
          {tableIsClosed
            ? <span className="hint">Partida cerrada. Los retiros se procesan en Monad Testnet.</span>
            : !tableHasStarted
            ? tableHasPaidSeats && alreadyInSelectedTable
              ? isHost
                ? <button disabled={gameLocking} onClick={startGame}>
                  {gameLocking ? "BLOQUEANDO MESA..." : "INICIAR PARTIDA"}
                </button>
                : <span className="hint">El host iniciará la partida cuando esté listo.</span>
              : <span className="hint">Cada jugador debe confirmar su buy-in para recibir 1000 fichas y habilitar la partida.</span>
            : currentGameState?.phase === "complete"
            ? <>
              {isHost && <>
                <button onClick={requestNextHand}>NUEVA MANO</button>
                <button className="secondary" onClick={closeGameForWithdrawals}>CERRAR PARTIDA Y HABILITAR RETIROS</button>
              </>}
              {!isHost && <span className="hint">El host decide cuándo continuar o cerrar la partida.</span>}
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
        {!tableHasStarted && !tableIsClosed && selectedTablePlayer?.paid && <button
          className="full secondary"
          disabled={refundPending}
          onClick={leaveTableAndRefund}
        >
          {refundPending
            ? "PROCESANDO REEMBOLSO..."
            : pendingRefundForTable
              ? "VERIFICAR REEMBOLSO CONFIRMADO"
              : "SALIR DE LA SALA Y REEMBOLSAR 0.01 MON"}
        </button>}
        {!tableHasStarted && !tableIsClosed && pendingRefundForTable && !selectedTablePlayer?.paid &&
          <button className="full secondary" disabled={refundPending} onClick={leaveTableAndRefund}>
            {refundPending ? "PROCESANDO REEMBOLSO..." : "SINCRONIZAR REEMBOLSO CON EL SERVIDOR"}
          </button>}
      </div>
      <aside>
        <section className="panel"><h2>Entrar a la mesa</h2><label>Nombre de jugador</label><input value={playerName} maxLength={20} onChange={(e) => setPlayerName(e.target.value)} placeholder="Ej. Reina del póker" />
          <label>ID de mesa</label><input value={tableId} onChange={(e) => setTableId(e.target.value)} />
          <label>Número de jugadores</label>
          <div className="actions player-count" role="group" aria-label="Número de jugadores">
            {[2, 3, 4].map((count) => <button
              aria-pressed={selectedPlayerCount === count}
              disabled={tableHasStarted || tableState.seatsTaken > 0}
              key={count}
              className={selectedPlayerCount === count ? "selected" : "secondary"}
              onClick={() => configureTableSize(count)}
            >{count}</button>)}
          </div>
          <button className="full" onClick={joinRealtimeTable}>Pagar 0.01 MON y entrar</button>
          <p className="hint">El servidor verifica el pago en Monad Testnet y asigna 1000 fichas. Se requiere MON de prueba para el buy-in y el gas.</p>
          <button className="full secondary" onClick={watchClosedSettlement}>Consultar retiros de esta mesa</button>
        </section>
        {tableIsClosed && <section className="panel">
          <h2>Retiros en Monad</h2>
          <p className="hint">El contrato reparte el 85% del escrow en proporción a las fichas finales. El 15% se envía al owner del contrato.</p>
          <button className="full secondary" onClick={() => refreshPayoutStatus().catch((error) =>
            setStatus(error.shortMessage || error.message)
          )}>ACTUALIZAR DISTRIBUCIÓN</button>
          {wallet && payoutStatus.owner
            && payoutStatus.owner.toLowerCase() === wallet.toLowerCase() && !payoutStatus.finalized &&
            <button className="full" onClick={finalizePayouts}>CONFIRMAR SALDOS FINALES EN MONAD</button>}
          {!payoutStatus.finalized
            ? <p className="hint">El administrador debe confirmar la distribución on-chain antes de retirar.</p>
            : <p>Distribución confirmada en Monad Testnet.</p>}
          {payoutStatus.finalized && BigInt(payoutStatus.claimable) > 0n &&
            <button className="full" onClick={claimPayout}>
              RETIRAR {formatEther(BigInt(payoutStatus.claimable))} MON A MI WALLET
            </button>}
          {payoutStatus.finalized && BigInt(payoutStatus.claimable) === 0n &&
            <p className="hint">Esta wallet no tiene MON pendiente por retirar.</p>}
          {wallet && payoutStatus.owner
            && payoutStatus.owner.toLowerCase() === wallet.toLowerCase() && payoutStatus.finalized &&
            BigInt(payoutStatus.adminFee) > 0n &&
            <button className="full secondary" onClick={withdrawAdminFee}>
              RETIRAR COMISIÓN {formatEther(BigInt(payoutStatus.adminFee))} MON
            </button>}
        </section>}
        <section className="panel"><h2>Actividad</h2>{actionLog.length ? actionLog.map((a,i)=><p className="log" key={i}>{a}</p>) : <p className="hint">Las acciones aparecerán aquí.</p>}</section>
      </aside>
    </section>
    <footer>Prototipo académico · Partida y fichas simuladas en el servidor · No usar con fondos reales</footer>
    {showInstructions && <div
      className="instructions-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowInstructions(false);
      }}
    >
      <section
        className="instructions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-title"
        aria-describedby="instructions-intro"
      >
        <div className="instructions-heading">
          <div>
            <span className="eyebrow">GUÍA RÁPIDA</span>
            <h2 id="instructions-title">Cómo usar PokerChain</h2>
          </div>
          <button
            ref={closeInstructionsRef}
            className="secondary instructions-close"
            onClick={() => setShowInstructions(false)}
            aria-label="Cerrar instrucciones"
          >CERRAR</button>
        </div>
        <p id="instructions-intro" className="hint">
          Sigue estos pasos para jugar Texas Hold'em y retirar tu saldo en Monad Testnet.
        </p>
        <ol className="instructions-list">
          <li><strong>Prepara MetaMask.</strong> Usa Monad Testnet (Chain ID 10143) y una wallet de prueba con MON suficiente para el buy-in y el gas.</li>
          <li><strong>Conecta tu wallet.</strong> Pulsa “Conectar MetaMask” y confirma tu cuenta. Al entrar, firma el mensaje de identidad; esa firma es gratuita.</li>
          <li><strong>Configura la mesa.</strong> Escribe tu nombre, el ID de mesa y el número de jugadores (2, 3 o 4). El primer jugador reserva el asiento y define la capacidad.</li>
          <li><strong>Paga el buy-in.</strong> Pulsa “Pagar 0.01 MON y entrar” y confirma la transacción en MetaMask. Cuando el servidor verifique el depósito, recibirás 1000 fichas. Cada jugador paga su propio buy-in.</li>
          <li><strong>Retírate antes de empezar.</strong> Mientras la mesa siga en espera, puedes pulsar “SALIR DE LA SALA Y REEMBOLSAR 0.01 MON”. La transacción devuelve el buy-in y libera tu asiento. Una vez que el host bloquee la mesa en Monad, ya no se permiten reembolsos.</li>
          <li><strong>Inicia y juega.</strong> Cuando todos los asientos estén pagados, el host pulsa “INICIAR PARTIDA” y confirma el bloqueo de la mesa en MetaMask. En tu turno, elige FOLD para retirarte de la mano, CHECK para pasar si no hay apuesta, CALL para igualar o RAISE para subir.</li>
          <li><strong>Continúa o cierra.</strong> Al terminar una mano, el host puede iniciar otra con “NUEVA MANO”. Cuando ya no jugarán más, pulsa “CERRAR PARTIDA Y HABILITAR RETIROS”. FOLD no devuelve el buy-in.</li>
          <li><strong>Confirma la distribución.</strong> El owner del contrato conecta la wallet que desplegó el contrato y confirma en MetaMask los saldos finales. El contrato asigna 85% del escrow según las fichas finales y reserva 15% para el owner.</li>
          <li><strong>Retira a tu wallet.</strong> Cada jugador conecta la misma wallet con la que pagó, consulta los retiros de su mesa y pulsa “RETIRAR ... MON A MI WALLET”. La transacción requiere gas.</li>
        </ol>
        <p className="instructions-warning">
          Esta es una demo: las partidas y fichas se calculan en el servidor y la distribución depende del owner. Usa solo MON de prueba; no envíes fondos reales ni compartas tu clave privada.
        </p>
      </section>
    </div>}
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);