// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Monad testnet escrow and chip-proportional payout prototype.
/// @dev The owner attests off-chain poker results. Do not use with real funds
/// before independent security review and a decentralized result-verification design.
contract PokerTable {
    uint8 public constant MIN_PLAYERS = 2;
    uint8 public constant MAX_PLAYERS = 4;
    uint256 public constant CHIPS_PER_BUY_IN = 1000;
    uint256 public constant FEE_BPS = 1500;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    address public immutable owner;
    uint256 public immutable buyIn;
    uint256 public tableId;
    uint8 public targetPlayerCount;
    uint8 public playerCount;
    address public tableHost;
    bool public gameStarted;
    bool public payoutsFinalized;
    uint256 public adminFee;

    address[4] public players;
    mapping(address => bool) public joined;
    mapping(address => uint256) public claimable;

    event PlayerJoined(address indexed player, uint256 amount);
    event PlayerRefunded(address indexed player, uint256 amount);
    event GameLocked(address indexed host);
    event PayoutsFinalized(uint256 playerPool, uint256 adminFee);
    event PayoutClaimed(address indexed player, uint256 amount);
    event AdminFeeWithdrawn(address indexed owner, uint256 amount);

    error IncorrectBuyIn();
    error InvalidPlayerCount();
    error PlayerCountMismatch();
    error TableFull();
    error AlreadyJoined();
    error GameAlreadyStarted();
    error GameNotStarted();
    error NotTableHost();
    error NotEnoughPlayers();
    error AlreadyFinalized();
    error NotFinalized();
    error NotOwner();
    error NotPlayer();
    error InvalidChipTotal();
    error NoPayout();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 _tableId, uint256 _buyIn) {
        require(_buyIn > 0, "buy-in must be > 0");
        owner = msg.sender;
        tableId = _tableId;
        buyIn = _buyIn;
    }

    function joinTable(uint8 _targetPlayerCount) external payable {
        if (payoutsFinalized) revert AlreadyFinalized();
        if (gameStarted) revert GameAlreadyStarted();
        if (msg.value != buyIn) revert IncorrectBuyIn();
        if (_targetPlayerCount < MIN_PLAYERS || _targetPlayerCount > MAX_PLAYERS) {
            revert InvalidPlayerCount();
        }
        if (targetPlayerCount != 0 && targetPlayerCount != _targetPlayerCount) {
            revert PlayerCountMismatch();
        }
        if (playerCount >= _targetPlayerCount) revert TableFull();
        if (joined[msg.sender]) revert AlreadyJoined();

        if (targetPlayerCount == 0) targetPlayerCount = _targetPlayerCount;
        joined[msg.sender] = true;
        players[playerCount] = msg.sender;
        if (playerCount == 0) tableHost = msg.sender;
        playerCount++;
        emit PlayerJoined(msg.sender, msg.value);
    }

    function lockGame() external {
        if (gameStarted) revert GameAlreadyStarted();
        if (msg.sender != tableHost) revert NotTableHost();
        if (targetPlayerCount == 0 || playerCount != targetPlayerCount) revert NotEnoughPlayers();
        gameStarted = true;
        emit GameLocked(msg.sender);
    }

    function leaveTableAndRefund() external {
        if (gameStarted) revert GameAlreadyStarted();
        if (payoutsFinalized) revert AlreadyFinalized();
        if (!joined[msg.sender]) revert NotPlayer();

        uint256 playerIndex = playerCount;
        for (uint256 i = 0; i < playerCount; i++) {
            if (players[i] == msg.sender) {
                playerIndex = i;
                break;
            }
        }
        if (playerIndex == playerCount) revert NotPlayer();

        joined[msg.sender] = false;
        for (uint256 i = playerIndex; i + 1 < playerCount; i++) {
            players[i] = players[i + 1];
        }
        playerCount--;
        players[playerCount] = address(0);
        if (playerCount == 0) {
            targetPlayerCount = 0;
            tableHost = address(0);
        } else if (tableHost == msg.sender) {
            tableHost = players[0];
        }

        (bool ok, ) = payable(msg.sender).call{value: buyIn}("");
        if (!ok) revert TransferFailed();
        emit PlayerRefunded(msg.sender, buyIn);
    }

    function finalizePayouts(uint256[4] calldata finalChips) external onlyOwner {
        if (payoutsFinalized) revert AlreadyFinalized();
        if (targetPlayerCount == 0 || playerCount != targetPlayerCount) revert NotEnoughPlayers();
        if (!gameStarted) revert GameNotStarted();

        uint256 totalChips;
        for (uint256 i = 0; i < playerCount; i++) {
            if (!joined[players[i]]) revert NotPlayer();
            totalChips += finalChips[i];
        }
        if (totalChips != uint256(playerCount) * CHIPS_PER_BUY_IN) revert InvalidChipTotal();

        payoutsFinalized = true;
        uint256 playerPool = (address(this).balance * (BPS_DENOMINATOR - FEE_BPS))
            / BPS_DENOMINATOR;
        uint256 totalPlayerPayout;
        for (uint256 i = 0; i < playerCount; i++) {
            uint256 payout = (playerPool * finalChips[i]) / totalChips;
            claimable[players[i]] = payout;
            totalPlayerPayout += payout;
        }

        adminFee = address(this).balance - totalPlayerPayout;
        emit PayoutsFinalized(totalPlayerPayout, adminFee);
    }

    function claimPayout() external {
        if (!payoutsFinalized) revert NotFinalized();
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NoPayout();

        claimable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PayoutClaimed(msg.sender, amount);
    }

    function withdrawAdminFee() external onlyOwner {
        if (!payoutsFinalized) revert NotFinalized();
        uint256 amount = adminFee;
        if (amount == 0) revert NoPayout();

        adminFee = 0;
        (bool ok, ) = payable(owner).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit AdminFeeWithdrawn(owner, amount);
    }

    function getPlayers() external view returns (address[4] memory) {
        return players;
    }

    function potBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
