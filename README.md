# PokerChain — prototipo académico

Prototipo de póker híbrido para dos a cuatro jugadores: React + ethers.js, servidor Node.js/Socket.IO y contrato Solidity desplegable con Hardhat.

## Alcance actual

- Contrato con buy-in fijo y selección de mesa para 2, 3 o 4 jugadores; la primera entrada fija la capacidad y la liquidación requiere completar esos asientos.
- Interfaz React para conectar MetaMask, elegir nombre de jugador, entrar a una sala y enviar el buy-in.
- Servidor Socket.IO con partidas locales de Texas Hold'em configurables para dos, tres o cuatro jugadores: turnos, rondas de apuestas, manos privadas y evaluación del ganador.
- Pruebas de contrato con Hardhat.

## Importante: no es apto para dinero real

La partida del servidor es una simulación local: cada jugador comienza con 1000 fichas, las ciegas son 10/20 y las cartas se reparten con aleatoriedad del servidor, no verificable por blockchain. Las fichas no representan MON ni están sincronizadas con el contrato. El contrato `settle(winner)` acepta el ganador indicado por quien llama y no garantiza que el resultado sea correcto. No conectes fondos reales ni despliegues en mainnet. Antes de producción hacen falta auditoría, aleatoriedad verificable, resolución de disputas, protección contra desconexiones y revisión legal.

### Condiciones de victoria

- Un jugador gana la mano inmediatamente si todos los demás se retiran (`fold`); recibe el bote sin revelar las cartas.
- Si quedan varios jugadores al final del river, gana quien tenga la mejor mano de cinco cartas entre sus dos cartas privadas y las cinco comunitarias.
- Las manos se ordenan de mayor a menor: escalera de color, póker, full house, color, escalera, trío, doble pareja, pareja y carta alta. Los desempates comparan rangos y kickers; si la mejor mano empata, los jugadores comparten el bote.
- Al terminar, la mesa anuncia al ganador y su mano, o indica que los demás se retiraron. Es una simulación del servidor, no un resultado verificable por blockchain.

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

Después de actualizar el contrato, vuelve a ejecutar `npm run compile` y `npm run deploy:local`, y reemplaza la dirección anterior por la nueva en `client/.env`. Cada contrato fija la cantidad elegida en el primer `joinTable`; todos los participantes deben enviar la misma selección. El buy-in es moneda nativa de la red (0.01 MON en una red configurada con MON); la etiqueta MON no convierte la moneda de otras redes.

Crea el archivo `client/.env` (Vite solo expone variables con prefijo `VITE_`). En MetaMask agrega la red local:
- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Símbolo de moneda: MON

Importa una cuenta de prueba de Hardhat solo en un entorno local desechable. El MON del entorno local es moneda de prueba; nunca uses claves de prueba en una red real.

## Ejecutar aplicación

Terminal 3:

```bash
npm run server
```

Para ejecutar las pruebas de la lógica de juego:

```bash
npm run test --workspace server
```

Terminal 4:

```bash
npm run client
```

Abre `http://localhost:5173`. Antes de entrar, elige un nombre (hasta 20 caracteres) y 2, 3 o 4 jugadores. El primer jugador que crea/ocupa la sala es el host; solo él puede cambiar su capacidad, iniciar una partida, continuar con **NUEVA MANO** o abrir **NUEVA PARTIDA**. Los demás deben seleccionar la capacidad definida por el host y pueden unirse a los asientos libres. En la mesa se muestra el nombre elegido; la billetera se conserva como identificador interno. Las acciones de póker siguen disponibles para cada participante cuando es su turno.

### Permitir conexiones desde otros equipos de la misma red

1. En el PC que ejecuta el proyecto, averigua su dirección IPv4 con `ipconfig` (por ejemplo, `192.168.1.50`). Los dispositivos deben estar conectados a la misma red local.
2. Inicia el servidor:

   ```powershell
   npm.cmd run server
   ```

   El servidor acepta por defecto conexiones web desde IP privadas de la red local. Solo necesitas `CLIENT_ORIGINS` para permitir un origen específico adicional.
3. Inicia el cliente con `npm.cmd run client`. Si Windows pregunta, permite Node.js en redes privadas. Si no aparece el aviso, habilita el acceso privado para Node.js o permite los puertos TCP `5173` y `3001` en el Firewall de Windows.
4. Comparte `http://192.168.1.50:5173` con los demás jugadores. Ellos deben abrir esa dirección, conectar su billetera y entrar al mismo ID de mesa. El navegador usará automáticamente el servidor del mismo equipo en el puerto `3001`.

Reemplaza la IP de ejemplo por la IPv4 real del PC servidor. Si la IP cambia, comparte la nueva dirección. Para usar un servidor de juego en otra dirección, define `VITE_GAME_SERVER_URL` en `client/.env` (por ejemplo, `http://192.168.1.50:3001`) y reinicia Vite.

Esta configuración es para una red local de confianza. No abras estos puertos a Internet ni configures redirección de puertos en el router: el servidor aún no autentica billeteras y las fichas son simuladas.

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
2. Sustituir la lógica local de Texas Hold'em por un mecanismo verificable y vincular su resultado de forma segura al contrato.
3. Diseñar un mecanismo verificable para barajar/repartir cartas privadas; Chainlink VRF por sí solo no resuelve la privacidad de cartas.
4. Sustituir la liquidación controlada por un mecanismo de resultado firmado/consensuado con disputas.
5. Implementar reembolsos seguros y auditar el contrato antes de cualquier uso con valor real.
