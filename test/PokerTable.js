const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PokerTable", function () {
  async function setup() {
    const [owner, p1, p2, p3, p4, outsider] = await ethers.getSigners();
    const buyIn = ethers.parseEther("0.01");
    const Factory = await ethers.getContractFactory("PokerTable");
    const table = await Factory.deploy(1, buyIn);
    return { owner, p1, p2, p3, p4, outsider, buyIn, table };
  }

  it("accepts exactly four unique players", async function () {
    const { p1, p2, p3, p4, buyIn, table } = await setup();
    for (const p of [p1, p2, p3, p4]) {
      await table.connect(p).joinTable({ value: buyIn });
    }
    expect(await table.playerCount()).to.equal(4);
    expect(await table.potBalance()).to.equal(buyIn * 4n);
  });

  it("rejects an incorrect buy-in", async function () {
    const { p1, buyIn, table } = await setup();
    await expect(table.connect(p1).joinTable({ value: buyIn - 1n }))
      .to.be.revertedWithCustomError(table, "IncorrectBuyIn");
  });

  it("pays the full pot to a seated winner", async function () {
    const { p1, p2, p3, p4, buyIn, table } = await setup();
    for (const p of [p1, p2, p3, p4]) {
      await table.connect(p).joinTable({ value: buyIn });
    }
    await expect(table.settle(p2.address))
      .to.emit(table, "PotSettled").withArgs(p2.address, buyIn * 4n);
    expect(await table.potBalance()).to.equal(0);
    expect(await table.settled()).to.equal(true);
  });

  it("rejects settlement before four players join", async function () {
    const { p1, buyIn, table } = await setup();
    await table.connect(p1).joinTable({ value: buyIn });
    await expect(table.settle(p1.address))
      .to.be.revertedWithCustomError(table, "NotFourPlayers");
  });
});