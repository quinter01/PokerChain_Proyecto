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

  it("accepts four unique players when the table is configured for four", async function () {
    const { p1, p2, p3, p4, buyIn, table } = await setup();
    for (const p of [p1, p2, p3, p4]) {
      await table.connect(p).joinTable(4, { value: buyIn });
    }
    expect(await table.playerCount()).to.equal(4);
    expect(await table.targetPlayerCount()).to.equal(4);
    expect(await table.potBalance()).to.equal(buyIn * 4n);
  });

  for (const playerCount of [2, 3, 4]) {
    it(`accepts a table configured for ${playerCount} players`, async function () {
      const { p1, p2, p3, p4, buyIn, table } = await setup();
      const players = [p1, p2, p3, p4].slice(0, playerCount);
      for (const player of players) {
        await table.connect(player).joinTable(playerCount, { value: buyIn });
      }
      expect(await table.playerCount()).to.equal(playerCount);
      expect(await table.targetPlayerCount()).to.equal(playerCount);
      expect(await table.potBalance()).to.equal(buyIn * BigInt(playerCount));
    });
  }

  it("rejects a player count outside the supported range", async function () {
    const { p1, buyIn, table } = await setup();
    await expect(table.connect(p1).joinTable(1, { value: buyIn }))
      .to.be.revertedWithCustomError(table, "InvalidPlayerCount");
    await expect(table.connect(p1).joinTable(5, { value: buyIn }))
      .to.be.revertedWithCustomError(table, "InvalidPlayerCount");
  });

  it("keeps the configured player count consistent and rejects extra players", async function () {
    const { p1, p2, p3, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await expect(table.connect(p2).joinTable(3, { value: buyIn }))
      .to.be.revertedWithCustomError(table, "PlayerCountMismatch");
    await table.connect(p2).joinTable(2, { value: buyIn });
    await expect(table.connect(p3).joinTable(2, { value: buyIn }))
      .to.be.revertedWithCustomError(table, "TableFull");
  });

  it("rejects an incorrect buy-in", async function () {
    const { p1, buyIn, table } = await setup();
    await expect(table.connect(p1).joinTable(2, { value: buyIn - 1n }))
      .to.be.revertedWithCustomError(table, "IncorrectBuyIn");
  });

  it("pays the full pot to a winner in a two-player table", async function () {
    const { p1, p2, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await expect(table.settle(p2.address))
      .to.emit(table, "PotSettled").withArgs(p2.address, buyIn * 2n);
    expect(await table.potBalance()).to.equal(0);
    expect(await table.settled()).to.equal(true);
  });

  it("pays the full pot to a winner in a three-player table", async function () {
    const { p1, p2, p3, buyIn, table } = await setup();
    for (const player of [p1, p2, p3]) {
      await table.connect(player).joinTable(3, { value: buyIn });
    }
    await expect(table.settle(p2.address))
      .to.emit(table, "PotSettled").withArgs(p2.address, buyIn * 3n);
    expect(await table.potBalance()).to.equal(0);
    expect(await table.settled()).to.equal(true);
  });

  it("pays the full pot to a seated winner in a four-player table", async function () {
    const { p1, p2, p3, p4, buyIn, table } = await setup();
    for (const p of [p1, p2, p3, p4]) {
      await table.connect(p).joinTable(4, { value: buyIn });
    }
    await expect(table.settle(p2.address))
      .to.emit(table, "PotSettled").withArgs(p2.address, buyIn * 4n);
    expect(await table.potBalance()).to.equal(0);
    expect(await table.settled()).to.equal(true);
  });

  it("rejects settlement before the configured number of players join", async function () {
    const { p1, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await expect(table.settle(p1.address))
      .to.be.revertedWithCustomError(table, "NotEnoughPlayers");
  });
});