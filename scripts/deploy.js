const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const MONAD_TESTNET_CHAIN_ID = 10143n;

function updateEnvFile(filePath, values) {
  let contents = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const matcher = new RegExp(`^${key}=.*$`, "m");
    if (matcher.test(contents)) {
      contents = contents.replace(matcher, line);
    } else {
      contents = `${contents}${contents && !contents.endsWith("\n") ? "\n" : ""}${line}\n`;
    }
  }
  fs.writeFileSync(filePath, contents);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const privateKey = process.env.MONAD_PRIVATE_KEY?.trim();
  if (network.chainId === MONAD_TESTNET_CHAIN_ID && !privateKey) {
    throw new Error(
      "No se cargó MONAD_PRIVATE_KEY desde el .env de la raíz. " +
      "Añade una clave privada de prueba; no uses una clave de fondos reales."
    );
  }
  if (network.chainId === MONAD_TESTNET_CHAIN_ID && !/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      "MONAD_PRIVATE_KEY debe tener 64 caracteres hexadecimales (32 bytes), opcionalmente con prefijo 0x. " +
      "El valor configurado parece una dirección pública, no una clave privada."
    );
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No hay una cuenta de despliegue configurada para la red seleccionada.");
  }
  const buyIn = ethers.parseEther("0.01");
  const Factory = await ethers.getContractFactory("PokerTable");
  const table = await Factory.deploy(1, buyIn);
  await table.waitForDeployment();
  const contractAddress = await table.getAddress();
  console.log("Deployer:", deployer.address);
  console.log("Chain ID:", network.chainId.toString());
  console.log("PokerTable:", contractAddress);
  console.log("Buy-in (MON):", ethers.formatEther(buyIn));

  if (network.chainId === MONAD_TESTNET_CHAIN_ID) {
    const rpcUrl = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
    updateEnvFile(path.join(__dirname, "..", "client", ".env"), {
      VITE_POKER_CONTRACT_ADDRESS: contractAddress,
      VITE_RPC_URL: rpcUrl
    });
    updateEnvFile(path.join(__dirname, "..", "server", ".env"), {
      POKER_CONTRACT_ADDRESS: contractAddress,
      MONAD_RPC_URL: rpcUrl
    });
    console.log("client/.env y server/.env actualizados con la configuración de Monad Testnet.");
    console.log(`Explorer: https://testnet.monadvision.com/address/${contractAddress}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
