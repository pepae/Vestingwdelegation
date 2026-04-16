// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.22 <0.9.0;

import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { VestingLibrary } from "./libraries/VestingLibrary.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Vesting contract for a single account
/// Original: https://github.com/safe-global/safe-token/blob/main/contracts/VestingPool.sol
/// @author Daniel Dimitrov - @compojoom, Fred Lührs - @fredo
contract VestingPool {
    event AddedVesting(bytes32 indexed id);
    event ClaimedVesting(bytes32 indexed id, address indexed beneficiary);
    event PausedVesting(bytes32 indexed id);
    event UnpausedVesting(bytes32 indexed id);
    event CancelledVesting(bytes32 indexed id);

    bool public initialised;
    address public owner;
    address public token;
    address public immutable sptToken;
    address public poolManager;
    uint256 public totalTokensInVesting;

    mapping(bytes32 => VestingLibrary.Vesting) public vestings;

    modifier onlyPoolManager() {
        require(msg.sender == poolManager, "Can only be called by pool manager");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Can only be claimed by vesting owner");
        _;
    }

    // solhint-disable-next-line no-empty-blocks
    constructor(address _sptToken) {
        sptToken = _sptToken;
    }

    /// @notice Initialize the vesting pool. Can only be called once.
    function initialize(
        address _token,
        address _poolManager,
        address _owner
    ) public {
        require(!initialised, "The contract has already been initialised.");
        require(_token != address(0), "Invalid token account");
        require(_poolManager != address(0), "Invalid pool manager account");
        require(_owner != address(0), "Invalid account");
        initialised = true;
        token = _token;
        poolManager = _poolManager;
        owner = _owner;
    }

    /// @notice Delegate all tokens held by this pool for voting purposes.
    /// @dev Only the pool owner (beneficiary) can call this.
    function delegateTokens(address delegatee) external onlyOwner {
        ERC20Votes(token).delegate(delegatee);
    }

    /// @notice Create a vesting on this pool. Only callable by pool manager.
    function addVesting(
        uint8 curveType,
        bool managed,
        uint16 durationWeeks,
        uint64 startDate,
        uint128 amount,
        uint128 initialUnlock,
        bool requiresSPT
    ) public virtual onlyPoolManager returns (bytes32) {
        return _addVesting(curveType, managed, durationWeeks, startDate, amount, initialUnlock, requiresSPT);
    }

    /// @notice Tokens available for creating new vestings.
    function tokensAvailableForVesting() public view virtual returns (uint256) {
        return ERC20Votes(token).balanceOf(address(this)) - totalTokensInVesting;
    }

    function _addVesting(
        uint8 curveType,
        bool managed,
        uint16 durationWeeks,
        uint64 startDate,
        uint128 amount,
        uint128 initialUnlock,
        bool requiresSPT
    ) internal returns (bytes32 vestingId) {
        require(curveType < 2, "Invalid vesting curve");
        vestingId = VestingLibrary.vestingHash(
            owner,
            curveType,
            managed,
            durationWeeks,
            startDate,
            amount,
            initialUnlock,
            requiresSPT
        );
        require(vestings[vestingId].amount == 0, "Vesting id already used");
        uint256 availableTokens = tokensAvailableForVesting();
        require(availableTokens >= amount, "Not enough tokens available");
        totalTokensInVesting += amount;
        vestings[vestingId] = VestingLibrary.Vesting({
            curveType: curveType,
            managed: managed,
            durationWeeks: durationWeeks,
            startDate: startDate,
            amount: amount,
            amountClaimed: 0,
            pausingDate: 0,
            cancelled: false,
            initialUnlock: initialUnlock,
            requiresSPT: requiresSPT
        });
        emit AddedVesting(vestingId);
    }

    /// @notice Claim vested tokens and transfer to beneficiary.
    /// @param vestingId ID of the vesting
    /// @param beneficiary Address to receive claimed tokens
    /// @param tokensToClaim Amount to claim, or type(uint128).max to claim all available
    function claimVestedTokens(
        bytes32 vestingId,
        address beneficiary,
        uint128 tokensToClaim
    ) public {
        VestingLibrary.Vesting storage vesting = vestings[vestingId];
        require(vesting.amount != 0, "Vesting not found");
        uint128 tokensClaimed = updateClaimedTokens(vestingId, beneficiary, tokensToClaim);
        if (vesting.requiresSPT) {
            require(
                IERC20(sptToken).transferFrom(msg.sender, address(this), tokensClaimed),
                "SPT transfer failed"
            );
        }
        require(
            ERC20Votes(token).transfer(beneficiary, tokensClaimed),
            "Token transfer failed"
        );
    }

    function updateClaimedTokens(
        bytes32 vestingId,
        address beneficiary,
        uint128 tokensToClaim
    ) internal onlyOwner returns (uint128 tokensClaimed) {
        require(beneficiary != address(0), "Cannot claim to 0-address");
        VestingLibrary.Vesting storage vesting = vestings[vestingId];
        uint128 availableClaim = _calculateVestedAmount(vesting) - vesting.amountClaimed;
        tokensClaimed = tokensToClaim == type(uint128).max ? availableClaim : tokensToClaim;
        require(tokensClaimed <= availableClaim, "Trying to claim too many tokens");
        totalTokensInVesting -= tokensClaimed;
        vesting.amountClaimed += tokensClaimed;
        emit ClaimedVesting(vestingId, beneficiary);
    }

    function cancelVesting(bytes32 vestingId) public onlyPoolManager {
        VestingLibrary.Vesting storage vesting = vestings[vestingId];
        require(vesting.amount != 0, "Vesting not found");
        require(vesting.managed, "Only managed vestings can be cancelled");
        require(!vesting.cancelled, "Vesting already cancelled");
        bool isFutureVesting = block.timestamp <= vesting.startDate;
        if (vesting.pausingDate == 0) {
            vesting.pausingDate = isFutureVesting ? vesting.startDate : uint64(block.timestamp);
        }
        uint128 unusedToken = isFutureVesting
            ? vesting.amount
            : vesting.amount - _calculateVestedAmount(vesting);
        totalTokensInVesting -= unusedToken;
        vesting.cancelled = true;
        emit CancelledVesting(vestingId);
    }

    function pauseVesting(bytes32 vestingId) public onlyPoolManager {
        VestingLibrary.Vesting storage vesting = vestings[vestingId];
        require(vesting.amount != 0, "Vesting not found");
        require(vesting.managed, "Only managed vestings can be paused");
        require(vesting.pausingDate == 0, "Vesting already paused");
        vesting.pausingDate = block.timestamp <= vesting.startDate
            ? vesting.startDate
            : uint64(block.timestamp);
        emit PausedVesting(vestingId);
    }

    function unpauseVesting(bytes32 vestingId) public onlyPoolManager {
        VestingLibrary.Vesting storage vesting = vestings[vestingId];
        require(vesting.amount != 0, "Vesting not found");
        require(vesting.pausingDate != 0, "Vesting is not paused");
        require(!vesting.cancelled, "Vesting has been cancelled and cannot be unpaused");
        uint64 timePaused = block.timestamp <= vesting.pausingDate
            ? 0
            : uint64(block.timestamp) - vesting.pausingDate;
        vesting.startDate = vesting.startDate + timePaused;
        vesting.pausingDate = 0;
        emit UnpausedVesting(vestingId);
    }

    function calculateVestedAmount(bytes32 vestingId)
        external
        view
        returns (uint128 vestedAmount, uint128 claimedAmount)
    {
        VestingLibrary.Vesting storage vesting = vestings[vestingId];
        require(vesting.amount != 0, "Vesting not found");
        vestedAmount = _calculateVestedAmount(vesting);
        claimedAmount = vesting.amountClaimed;
    }

    function _calculateVestedAmount(VestingLibrary.Vesting storage vesting)
        internal
        view
        returns (uint128 vestedAmount)
    {
        require(vesting.startDate <= block.timestamp, "Vesting not active yet");
        uint64 durationSeconds = uint64(vesting.durationWeeks) * 7 * 24 * 60 * 60;
        uint64 vestedSeconds = vesting.pausingDate > 0
            ? vesting.pausingDate - vesting.startDate
            : uint64(block.timestamp) - vesting.startDate;
        if (vestedSeconds >= durationSeconds) {
            vestedAmount = vesting.amount;
        } else if (vesting.curveType == 0) {
            vestedAmount =
                calculateLinear(vesting.amount - vesting.initialUnlock, vestedSeconds, durationSeconds) +
                vesting.initialUnlock;
        } else if (vesting.curveType == 1) {
            vestedAmount =
                calculateExponential(vesting.amount - vesting.initialUnlock, vestedSeconds, durationSeconds) +
                vesting.initialUnlock;
        } else {
            revert("Invalid curve type");
        }
    }

    function calculateLinear(uint128 targetAmount, uint64 elapsedTime, uint64 totalTime)
        internal
        pure
        returns (uint128)
    {
        uint256 amount = (uint256(targetAmount) * uint256(elapsedTime)) / uint256(totalTime);
        require(amount <= type(uint128).max, "Overflow in curve calculation");
        return uint128(amount);
    }

    function calculateExponential(uint128 targetAmount, uint64 elapsedTime, uint64 totalTime)
        internal
        pure
        returns (uint128)
    {
        uint256 amount =
            (uint256(targetAmount) * uint256(elapsedTime) * uint256(elapsedTime)) /
            (uint256(totalTime) * uint256(totalTime));
        require(amount <= type(uint128).max, "Overflow in curve calculation");
        return uint128(amount);
    }
}
