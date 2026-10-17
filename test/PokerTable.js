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

  it("refunds a player leaving the waiting room and frees the seat", async function () {
    const { p1, p2, p3, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });

    await expect(table.connect(p1).leaveTableAndRefund())
      .to.emit(table, "PlayerRefunded").withArgs(p1.address, buyIn);
    expect(await table.joined(p1.address)).to.equal(false);
    expect(await table.playerCount()).to.equal(1);
    expect(await table.players(0)).to.equal(p2.address);
    expect(await table.tableHost()).to.equal(p2.address);
    expect(await table.potBalance()).to.equal(buyIn);

    await table.connect(p3).joinTable(2, { value: buyIn });
    expect(await table.playerCount()).to.equal(2);
  });

  it("allows the last player to leave and resets the unstarted table", async function () {
    const { p1, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });

    await table.connect(p1).leaveTableAndRefund();
    expect(await table.playerCount()).to.equal(0);
    expect(await table.targetPlayerCount()).to.equal(0);
    expect(await table.tableHost()).to.equal(ethers.ZeroAddress);
    expect(await table.potBalance()).to.equal(0);
  });

  it("only the on-chain table host can lock a full table", async function () {
    const { p1, p2, outsider, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });

    await expect(table.connect(outsider).lockGame())
      .to.be.revertedWithCustomError(table, "NotTableHost");
    await expect(table.connect(p1).lockGame())
      .to.emit(table, "GameLocked").withArgs(p1.address);
    expect(await table.gameStarted()).to.equal(true);
  });

  it("rejects a refund after the host has locked the game", async function () {
    const { p1, p2, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await table.connect(p1).lockGame();

    await expect(table.connect(p2).leaveTableAndRefund())
      .to.be.revertedWithCustomError(table, "GameAlreadyStarted");
  });

  it("allocates 85% of the escrow proportionally to final chips in a two-player table", async function () {
    const { owner, p1, p2, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await table.connect(p1).lockGame();
    await expect(table.connect(owner).finalizePayouts([1500, 500, 0, 0]))
      .to.emit(table, "PayoutsFinalized").withArgs(
        ethers.parseEther("0.017"),
        ethers.parseEther("0.003")
      );
    expect(await table.claimable(p1.address)).to.equal(ethers.parseEther("0.01275"));
    expect(await table.claimable(p2.address)).to.equal(ethers.parseEther("0.00425"));
    expect(await table.adminFee()).to.equal(ethers.parseEther("0.003"));
    expect(await table.payoutsFinalized()).to.equal(true);
  });

  it("distributes the player pool evenly in a three-player table", async function () {
    const { owner, p1, p2, p3, buyIn, table } = await setup();
    for (const player of [p1, p2, p3]) {
      await table.connect(player).joinTable(3, { value: buyIn });
    }
    await table.connect(p1).lockGame();
    await table.connect(owner).finalizePayouts([1000, 1000, 1000, 0]);
    expect(await table.claimable(p1.address)).to.equal(ethers.parseEther("0.0085"));
    expect(await table.claimable(p2.address)).to.equal(ethers.parseEther("0.0085"));
    expect(await table.claimable(p3.address)).to.equal(ethers.parseEther("0.0085"));
    expect(await table.adminFee()).to.equal(ethers.parseEther("0.0045"));
  });

  it("does not assign a payout to a player with no final chips", async function () {
    const { owner, p1, p2, p3, p4, buyIn, table } = await setup();
    for (const p of [p1, p2, p3, p4]) {
      await table.connect(p).joinTable(4, { value: buyIn });
    }
    await table.connect(p1).lockGame();
    await table.connect(owner).finalizePayouts([2500, 500, 1000, 0]);
    expect(await table.claimable(p1.address)).to.equal(ethers.parseEther("0.02125"));
    expect(await table.claimable(p2.address)).to.equal(ethers.parseEther("0.00425"));
    expect(await table.claimable(p3.address)).to.equal(ethers.parseEther("0.0085"));
    expect(await table.claimable(p4.address)).to.equal(0);
  });

  it("lets each player claim once and lets the owner withdraw the 15% fee", async function () {
    const { owner, p1, p2, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await table.connect(p1).lockGame();
    await table.connect(owner).finalizePayouts([1000, 1000, 0, 0]);

    await expect(table.connect(p1).claimPayout())
      .to.emit(table, "PayoutClaimed").withArgs(p1.address, ethers.parseEther("0.0085"));
    expect(await table.claimable(p1.address)).to.equal(0);
    await expect(table.connect(p1).claimPayout())
      .to.be.revertedWithCustomError(table, "NoPayout");

    await expect(table.connect(owner).withdrawAdminFee())
      .to.emit(table, "AdminFeeWithdrawn").withArgs(owner.address, ethers.parseEther("0.003"));
    expect(await table.potBalance()).to.equal(ethers.parseEther("0.0085"));
  });

  it("rejects finalization by anyone except the contract owner", async function () {
    const { p1, p2, outsider, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await table.connect(p1).lockGame();
    await expect(table.connect(outsider).finalizePayouts([1000, 1000, 0, 0]))
      .to.be.revertedWithCustomError(table, "NotOwner");
  });

  it("rejects chip distributions that do not preserve the bought-in chip total", async function () {
    const { owner, p1, p2, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await table.connect(p1).lockGame();
    await expect(table.connect(owner).finalizePayouts([1000, 999, 0, 0]))
      .to.be.revertedWithCustomError(table, "InvalidChipTotal");
    expect(await table.payoutsFinalized()).to.equal(false);
  });

  it("rejects finalization before the configured number of players join", async function () {
    const { owner, p1, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await expect(table.connect(owner).finalizePayouts([1000, 0, 0, 0]))
      .to.be.revertedWithCustomError(table, "NotEnoughPlayers");
  });

  it("rejects new buy-ins after payouts are finalized", async function () {
    const { owner, p1, p2, p3, buyIn, table } = await setup();
    await table.connect(p1).joinTable(2, { value: buyIn });
    await table.connect(p2).joinTable(2, { value: buyIn });
    await table.connect(p1).lockGame();
    await table.connect(owner).finalizePayouts([1000, 1000, 0, 0]);
    await expect(table.connect(p3).joinTable(2, { value: buyIn }))
      .to.be.revertedWithCustomError(table, "AlreadyFinalized");
  });
});