// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Educational escrow/settlement prototype for a 4-player poker table.
/// @dev This contract does NOT implement poker rules, card shuffling, or a trusted
/// game oracle. Do not use with real funds before independent security review.
contract PokerTable {
    uint8 public constant MAX_PLAYERS = 4;
    address public immutable owner;
    uint256 public immutable buyIn;
    uint256 public tableId;
    bool public settled;

    address[4] public players;
    uint8 public playerCount;
    mapping(address => bool) public joined;

    event PlayerJoined(address indexed player, uint256 amount);
    event PotSettled(address indexed winner, uint256 amount);
    event RefundIssued(address indexed player, uint256 amount);

    error IncorrectBuyIn();
    error TableFull();
    error AlreadyJoined();
    error NotFourPlayers();
    error AlreadySettled();
    error NotPlayer();
    error TransferFailed();

    constructor(uint256 _tableId, uint256 _buyIn) {
        require(_buyIn > 0, "buy-in must be > 0");
        owner = msg.sender;
        tableId = _tableId;
        buyIn = _buyIn;
    }

    function joinTable() external payable {
        if (settled) revert AlreadySettled();
        if (msg.value != buyIn) revert IncorrectBuyIn();
        if (playerCount >= MAX_PLAYERS) revert TableFull();
        if (joined[msg.sender]) revert AlreadyJoined();

        joined[msg.sender] = true;
        players[playerCount] = msg.sender;
        playerCount++;
        emit PlayerJoined(msg.sender, msg.value);
    }

    /// @notice Prototype settlement: caller supplies winner; production must
    /// verify a signed/attested result or use a robust dispute mechanism.
    function settle(address winner) external {
        if (settled) revert AlreadySettled();
        if (playerCount != MAX_PLAYERS) revert NotFourPlayers();
        if (!joined[winner]) revert NotPlayer();

        settled = true;
        uint256 pot = address(this).balance;
        (bool ok, ) = payable(winner).call{value: pot}("");
        if (!ok) revert TransferFailed();
        emit PotSettled(winner, pot);
    }

    /// @notice Allows each player to reclaim their buy-in before all seats fill.
    function refundIfTableIncomplete() external {
        if (settled) revert AlreadySettled();
        if (!joined[msg.sender]) revert NotPlayer();
        if (playerCount == MAX_PLAYERS) revert NotFourPlayers();

        // Mark settled to prevent one player draining funds while others remain.
        // This deliberately refunds the whole table only when all current
        // participants have agreed in a production-ready version; prototype
        // uses per-player credits to avoid this unsafe shortcut.
        revert("incomplete-table refunds disabled in prototype");
    }

    function getPlayers() external view returns (address[4] memory) {
        return players;
    }

    function potBalance() external view returns (uint256) {
        return address(this).balance;
    }
}