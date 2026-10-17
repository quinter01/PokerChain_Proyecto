const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const buyIn = ethers.parseEther("0.01");
  const Factory = await ethers.getContractFactory("PokerTable");
  const table = await Factory.deploy(1, buyIn);
  await table.waitForDeployment();
  console.log("Deployer:", deployer.address);
  console.log("PokerTable:", await table.getAddress());
  console.log("Buy-in (ETH):", ethers.formatEther(buyIn));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
