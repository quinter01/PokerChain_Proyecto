# PokerChain — prototipo académico

Prototipo de póker híbrido para cuatro jugadores: React + ethers.js, servidor Node.js/Socket.IO y contrato Solidity desplegable con Hardhat.

## Alcance actual

- Contrato de depósito de buy-in fijo para cuatro direcciones y liquidación del bote a una dirección ganadora.
- Interfaz React básica para conectar MetaMask, solicitar entrada a una sala y enviar el buy-in.
- Servidor Socket.IO para estado de sala y eventos de acciones de demostración.
- Pruebas de contrato con Hardhat.

## Importante: no es apto para dinero real

La lógica de juego, evaluación de manos, turnos, control de apuestas, aleatoriedad verificable y resolución de disputas NO están implementados. El contrato `settle(winner)` acepta el ganador indicado por quien llama: sirve para demostrar el flujo, pero no garantiza que el resultado sea correcto. No conectes fondos reales ni despliegues en mainnet. Antes de producción hacen falta auditoría, reglas completas, sistema seguro de reembolsos, mecanismo de consenso/atestación de resultados, protección contra desconexiones y revisión legal.

## Requisitos

- Node.js 20 o superior
- Git
- Visual Studio Code
- MetaMask (solo para la demo)
- Extensión Solidity para VS Code (opcional)

## Instalación

Desde la raíz del repositorio:

```bash
npm install
cp .env.example .env
```

En Windows PowerShell, si `cp` no funciona:

```powershell
Copy-Item .env.example .env
```

## Ejecutar contrato local

Terminal 1:

```bash
npm run node
```

Terminal 2:

```bash
npm run compile
npm test
npm run deploy:local
```

Copia la dirección `PokerTable: 0x...` que imprime el despliegue y pégala en `client/.env`:

```env
VITE_POKER_CONTRACT_ADDRESS=0xDIRECCION_DEL_CONTRATO
VITE_RPC_URL=http://127.0.0.1:8545
```

Crea el archivo `client/.env` (Vite solo expone variables con prefijo `VITE_`). En MetaMask agrega la red local:
- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Moneda: ETH

Importa una cuenta de prueba de Hardhat solo en un entorno local desechable. Nunca uses claves de prueba en una red real.

## Ejecutar aplicación

Terminal 3:

```bash
npm run server
```

Terminal 4:

```bash
npm run client
```

Abre `http://localhost:5173`.

## Flujo Git para cuatro integrantes

Usen una rama por tarea y hagan Pull Request a `main`. No trabajen directamente sobre `main`.

1. `main`: rama estable.
2. `develop`: integración de trabajo probado.
3. `feature/contrato`: contrato, pruebas y despliegue.
4. `feature/servidor`: salas y WebSockets.
5. `feature/frontend`: React, estilos y conexión de billetera.
6. `feature/integracion`: pruebas end-to-end, documentación y revisión.

Ejemplo de inicio para cada persona:

```bash
git clone <URL_DEL_REPOSITORIO>
cd poker-blockchain
git checkout develop
git pull origin develop
git checkout -b feature/tu-tarea
# trabajar y probar
git add .
git commit -m "feat: describe el cambio"
git push -u origin feature/tu-tarea
```

Después creen un Pull Request hacia `develop`, pidan revisión a otra persona y resuelvan conflictos antes de integrar. Una persona puede coordinar releases; todos revisan cambios del contrato y nadie sube `.env`, claves privadas ni archivos `node_modules`.

## Reparto sugerido

- Persona 1 — Solidity/Hardhat: contrato, tests y despliegue local.
- Persona 2 — Backend: Socket.IO, salas, validación de acciones y estado de partida.
- Persona 3 — Frontend: React, UX, conexión de billetera y visualización.
- Persona 4 — Integración/QA: reglas de póker, evaluación de manos, pruebas de integración, documentación y revisión de seguridad.

## Estructura

```text
contracts/PokerTable.sol
scripts/deploy.js
test/PokerTable.js
server/src/index.js
client/src/main.jsx
client/src/style.css
```

## Próximos pasos

1. Implementar un único socket compartido en el frontend y validar identidad de billetera.
2. Implementar reglas de Texas Hold'em, turnos, stacks y evaluación de manos con pruebas.
3. Diseñar un mecanismo verificable para barajar/repartir cartas privadas; Chainlink VRF por sí solo no resuelve la privacidad de cartas.
4. Sustituir la liquidación controlada por un mecanismo de resultado firmado/consensuado con disputas.
5. Implementar reembolsos seguros y auditar el contrato antes de cualquier uso con valor real.
