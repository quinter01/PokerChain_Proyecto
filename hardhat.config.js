require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

const configuredPrivateKey = process.env.MONAD_PRIVATE_KEY?.trim();
if (configuredPrivateKey && !/^(0x)?[0-9a-fA-F]{64}$/.test(configuredPrivateKey)) {
  throw new Error(
    "MONAD_PRIVATE_KEY no tiene un formato válido. Usa la clave privada de 32 bytes " +
    "(64 caracteres hexadecimales, con o sin 0x), no la dirección pública de la wallet."
  );
}
const monadPrivateKey = configuredPrivateKey
  ? `0x${configuredPrivateKey.replace(/^0x/i, "")}`
  : undefined;

module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    monadTestnet: {
      url: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: monadPrivateKey ? [monadPrivateKey] : []
    }
  }
};