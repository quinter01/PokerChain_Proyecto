# PokerChain — prototipo académico

Prototipo de póker híbrido para dos a cuatro jugadores: React + ethers.js, servidor Node.js/Socket.IO y contrato Solidity desplegable con Hardhat.

## Alcance actual

- Contrato con buy-in fijo de `0.01 MON`, mesa de 2 a 4 jugadores y retiros individuales después del cierre.
- Interfaz React para conectar MetaMask, elegir nombre de jugador, entrar a una sala y enviar el buy-in.
- Servidor Socket.IO con partidas locales de Texas Hold'em configurables para dos, tres o cuatro jugadores: turnos, rondas de apuestas, manos privadas y evaluación del ganador.
- Pruebas de contrato con Hardhat.

## Importante: no es apto para dinero real

La partida y sus fichas se calculan en el servidor, no en blockchain. Al cerrar la partida, el owner del contrato confirma los saldos finales; el contrato reserva el 15% del escrow para ese owner y asigna el 85% restante proporcionalmente a las fichas finales. Cada participante reclama su pago en su propia wallet de Monad. Esta versión confía en el owner para reportar el resultado y no debe usarse con fondos reales ni desplegarse en mainnet. Antes de producción hacen falta auditoría independiente, verificación descentralizada de resultados, protección contra desconexiones, persistencia y revisión legal.

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

## Desplegar en Monad Testnet

La red oficial de prueba de Monad usa Chain ID `10143`, símbolo `MON` y RPC `https://testnet-rpc.monad.xyz`. Consulta también la [documentación oficial de red](https://docs.monad.xyz/developer-essentials/testnet).

Terminal 1:

```bash
npm.cmd run compile
npm.cmd test
```

Crea `.env` en la raíz copiando `.env.example`, y configura `MONAD_PRIVATE_KEY` con una cuenta dedicada de Monad Testnet que tenga MON de prueba. Solicita fondos solo en el faucet oficial de [Monad](https://faucet.monad.xyz). **Nunca uses una clave con fondos reales ni compartas o subas `.env`.**

Despliega el contrato en Monad Testnet:

```powershell
npm.cmd run deploy:monad-testnet
```

Al completar el despliegue, el script actualiza automáticamente `VITE_POKER_CONTRACT_ADDRESS` y `VITE_RPC_URL` en `client/.env`, y `POKER_CONTRACT_ADDRESS` y `MONAD_RPC_URL` en `server/.env`. Reinicia Vite y el servidor Node después del despliegue; el servidor consulta Monad Testnet para verificar cada depósito. Cada partida debe usar un contrato nuevo, así que se requiere un nuevo despliegue para una nueva mesa/torneo. La cuenta administradora es el owner que despliega el contrato y será quien reciba la comisión y confirme los saldos finales.

Cada contrato fija la cantidad elegida en el primer `joinTable`; todos los participantes deben indicar la misma selección. El buy-in de demostración es `0.01 MON` por jugador y, después de confirmar el depósito, el servidor asigna exactamente `1000` fichas simuladas a esa billetera. El servidor valida el recibo, el contrato, el monto, el emisor y la cantidad de jugadores; no confía en una confirmación enviada solo por el navegador. En MetaMask selecciona o agrega Monad Testnet (RPC `https://testnet-rpc.monad.xyz`, Chain ID `10143`, símbolo `MON`). No uses `localhost`, `127.0.0.1` ni una dirección de despliegue Hardhat con esta red.

Mientras la sala está esperando jugadores, cada participante pagado puede usar **SALIR DE LA SALA Y REEMBOLSAR 0.01 MON**. MetaMask ejecuta `leaveTableAndRefund()` y devuelve el buy-in completo a la wallet que pagó; el servidor solo libera el asiento después de verificar el recibo y el evento `PlayerRefunded`. El host inicia la partida bloqueando primero el contrato en Monad con `lockGame()`. Desde ese momento no se permiten reembolsos. Esta lógica requiere desplegar la versión nueva de `PokerTable`; los contratos desplegados anteriormente no tienen estas funciones y no pueden procesar reembolsos con este flujo.

Cuando todos hayan pagado y la última mano haya terminado, el host elige **CERRAR PARTIDA Y HABILITAR RETIROS**. El owner del contrato conecta esa wallet, consulta la misma mesa y confirma los saldos finales en MetaMask. Si el owner no jugó, conecta la wallet administradora, escribe el ID de la mesa y pulsa **Consultar retiros de esta mesa**. El contrato reparte el 85% de los buy-ins custodiados en proporción al saldo de fichas; el 15% y el residuo de redondeo quedan para el owner. Después cada jugador conecta la wallet con que pagó y elige **RETIRAR ... MON A MI WALLET**. El retiro y la comisión requieren gas de testnet. Hacer `FOLD` solo retira al jugador de esa mano; no cancela el buy-in ni habilita un pago anticipado. La distribución cerrada se guarda en `server/data/settlements.json` para poder recuperarla si Node se reinicia.

Para seguir usando Hardhat local como alternativa, ejecuta `npm.cmd run node` y `npm.cmd run deploy:local`; la dirección local no es la dirección del contrato en Monad Testnet.

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

Abre `http://localhost:5173`. Conecta la billetera de prueba de cada jugador, elige un nombre (hasta 20 caracteres) y 2, 3 o 4 jugadores. Al entrar, MetaMask pide firmar un mensaje de autenticación gratuito y confirmar el buy-in de `0.01 MON`; una vez verificado el depósito, se acreditan `1000` fichas. El servidor utiliza la dirección firmante como identidad. El host on-chain —la wallet que hizo el primer depósito efectivo— puede iniciar la partida, continuar con **NUEVA MANO** o cerrar la partida para los retiros; antes de iniciar, cada jugador puede salir y recibir su reembolso. En la mesa se muestra el nombre elegido y el saldo de fichas. Las acciones de póker siguen disponibles para cada participante cuando es su turno.

### Permitir conexiones desde otros equipos de la misma red

1. En el PC que ejecuta el proyecto, averigua su dirección IPv4 con `ipconfig` (por ejemplo, `192.168.1.50`). Los dispositivos deben estar conectados a la misma red local.
2. Inicia el servidor:

   ```powershell
   $env:HOST = "0.0.0.0"
   npm.cmd run server
   ```

   `0.0.0.0` hace que Node escuche en todas las interfaces de red; no es la IP que se comparte. Si quieres escuchar solo en una interfaz, reemplázalo por la IPv4 concreta (por ejemplo, `$env:HOST = "192.168.1.50"`). El servidor acepta por defecto conexiones web desde IP privadas de la red local. Solo necesitas `CLIENT_ORIGINS` para permitir un origen específico adicional.
3. Inicia el cliente con `npm.cmd run client`. Si Windows pregunta, permite Node.js en redes privadas. Si no aparece el aviso, habilita el acceso privado para Node.js o permite los puertos TCP `5173` y `3001` en el Firewall de Windows.
4. Comparte `http://192.168.1.50:5173` con los demás jugadores. Ellos deben abrir esa dirección, conectar su billetera y entrar al mismo ID de mesa. El navegador usará automáticamente el servidor del mismo equipo en el puerto `3001`.

Reemplaza la IP de ejemplo por la IPv4 real del PC servidor. Si la IP cambia, comparte la nueva dirección. Si la página y el servidor de juego están en equipos distintos, define `VITE_GAME_SERVER_URL` en `client/.env` con la IPv4 del equipo que corre Node (por ejemplo, `VITE_GAME_SERVER_URL=http://192.168.1.50:3001`) y reinicia Vite. Si ambos corren en el mismo PC y abres la página con su IP, no necesitas definir esta variable: el cliente usa automáticamente el hostname de la página.

No abras estos puertos a Internet ni configures redirección de puertos en el router. Aunque el servidor verifica los buy-ins en la blockchain, las partidas y las fichas se gestionan en memoria y no son un token transferible ni una garantía de pago. El contrato actual tampoco liquida automáticamente el saldo de fichas al ganador.

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
