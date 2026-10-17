import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import { BrowserProvider, Contract, parseEther } from "ethers";
import "./style.css";

const ABI = [
  "function joinTable() payable",
  "function buyIn() view returns (uint256)",
  "function playerCount() view returns (uint8)",
  "function potBalance() view returns (uint256)",
  "function getPlayers() view returns (address[4])",
  "function settle(address winner)"
];
const CONTRACT_ADDRESS = import.meta.env.VITE_POKER_CONTRACT_ADDRESS;
const SOCKET_URL = "http://localhost:3001";

function App() {
  const socketRef = useRef(null);
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("Conecta MetaMask para comenzar.");
  const [tableState, setTableState] = useState({ players: [], seatsTaken: 0, maxPlayers: 4 });
  const [tableId, setTableId] = useState("1");
  const [actionLog, setActionLog] = useState([]);
  const [contract, setContract] = useState(null);

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;
    socket.on("server:message", (m) => setStatus(m.text));
    socket.on("table:state", setTableState);
    socket.on("game:action", (m) => setActionLog((old) => [`${m.player}: ${m.action.type}`, ...old].slice(0, 8)));
    socket.on("game:error", (e) => setStatus(e.message));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

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
    const socket = socketRef.current;
    if (!socket) return setStatus("No hay conexión con el servidor de juego.");
    const join = () => socket.emit("table:join", { tableId, walletAddress: wallet });
    if (socket.connected) join();
    else socket.once("connect", join);
    setStatus("Solicitud de entrada enviada al servidor de juego.");
  }

  async function depositBuyIn() {
    try {
      if (!contract) throw new Error("Configura VITE_POKER_CONTRACT_ADDRESS y vuelve a cargar.");
      const tx = await contract.joinTable({ value: await contract.buyIn() });
      setStatus("Transacción enviada. Esperando confirmación...");
      await tx.wait();
      setStatus("Buy-in confirmado en blockchain.");
    } catch (e) { setStatus(e.shortMessage || e.message); }
  }

  function sendAction(type) {
    const socket = socketRef.current;
    if (socket?.connected) socket.emit("game:action", { tableId, action: { type } });
    setActionLog((old) => [`Acción enviada: ${type} (demo)`, ...old].slice(0, 8));
  }

  return <main className="shell">
    <header><div><span className="eyebrow">WEB3 · TEXAS HOLD'EM</span><h1>PokerChain</h1><p>Póker híbrido para cuatro jugadores</p></div>
      <button onClick={connectWallet}>{wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Conectar MetaMask"}</button>
    </header>
    <div className="status">{status}</div>
    <section className="layout">
      <div className="table-panel">
        <div className="table-top"><span>MESA #{tableId}</span><span>{tableState.seatsTaken}/4 jugadores conectados</span></div>
        <div className="poker-table">
          <div className="pot">BOTE EN CADENA<strong>Se consulta en el contrato</strong></div>
          <div className="cards"><span>🂠</span><span>🂠</span><span>🂠</span><span>🂠</span><span>🂠</span></div>
          <p>Esperando jugadores…</p>
          <div className="seats">{[0,1,2,3].map((i) => <div className="seat" key={i}><span className="seat-icon">♙</span><span>{tableState.players[i] ? `${tableState.players[i].slice(0,6)}…` : `Asiento ${i+1}`}</span></div>)}</div>
        </div>
        <div className="actions">{["check","call","raise","fold"].map((a) => <button className={a==="fold"?"danger":""} key={a} onClick={() => sendAction(a)}>{a.toUpperCase()}</button>)}</div>
      </div>
      <aside>
        <section className="panel"><h2>Entrar a la mesa</h2><label>ID de mesa</label><input value={tableId} onChange={(e) => setTableId(e.target.value)} />
          <button className="full" onClick={joinRealtimeTable}>Conectar a sala en tiempo real</button>
          <button className="full secondary" onClick={depositBuyIn}>Depositar buy-in (ETH de prueba)</button>
          <p className="hint">Usa solo una red local de Hardhat y cuentas de prueba.</p>
        </section>
        <section className="panel"><h2>Actividad</h2>{actionLog.length ? actionLog.map((a,i)=><p className="log" key={i}>{a}</p>) : <p className="hint">Las acciones aparecerán aquí.</p>}</section>
      </aside>
    </section>
    <footer>Prototipo académico · No usar con fondos reales · La lógica de cartas y apuestas aún no está implementada</footer>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);