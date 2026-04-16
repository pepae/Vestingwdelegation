// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.22 <0.9.0;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { VestingPool } from "./VestingPool.sol";
import { ModuleManager } from "./interfaces/ModuleManager.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal interface needed from the vesting token.
interface IVestingToken is IERC20 {
    function paused() external view returns (bool);
}

/// @title Vesting Pool Manager
/// @author Daniel Dimitrov - @compojoom, Fred Lührs - @fredo
/// Source: https://github.com/shutter-network/shutter-dao/blob/main/contracts/VestingPoolManager.sol
contract VestingPoolManager {
    // Mapping of user address to vesting pool address
    mapping(address => address) private userToVestingPool;

    // Address of the vesting pool implementation
    address public immutable vestingPoolImplementation;
    IVestingToken public immutable token;
    address public immutable dao;

    modifier onlyDao() {
        require(msg.sender == dao, "Can only be called by pool manager");
        _;
    }

    constructor(
        address _token,
        address _vestingPoolImplementation,
        address _dao
    ) {
        token = IVestingToken(_token);
        vestingPoolImplementation = _vestingPoolImplementation;
        dao = _dao;
    }

    /// @notice Creates a vesting pool for the user
    function addVestingPool(address user) private returns (address) {
        require(user != address(0), "Invalid user address");
        require(
            userToVestingPool[user] == address(0),
            "Vesting pool already exists for the user"
        );

        address vestingPool = Clones.clone(vestingPoolImplementation);
        VestingPool(vestingPool).initialize(address(token), address(this), user);
        userToVestingPool[user] = vestingPool;
        return vestingPool;
    }

    /// @notice Get the vesting pool for the user or revert if it does not exist
    function getVestingPool(address user) public view returns (address) {
        address vestingPool = userToVestingPool[user];
        require(vestingPool != address(0), "Vesting pool does not exist");
        return vestingPool;
    }

    /// @notice Add a vesting to the vesting pool of the user
    function addVesting(
        address account,
        uint8 curveType,
        bool managed,
        uint16 durationWeeks,
        uint64 startDate,
        uint128 amount,
        uint128 initialUnlock,
        bool requiresSPT
    ) external returns (bytes32) {
        address vestingPool = userToVestingPool[account];

        if (vestingPool == address(0)) {
            vestingPool = addVestingPool(account);
        }

        if (token.paused()) {
            transferViaModule(account, amount);
        } else {
            token.transferFrom(msg.sender, vestingPool, amount);
        }

        return
            VestingPool(vestingPool).addVesting(
                curveType,
                managed,
                durationWeeks,
                startDate,
                amount,
                initialUnlock,
                requiresSPT
            );
    }

    /// @notice If the token is paused, transfer tokens via Safe module transaction
    function transferViaModule(address account, uint128 amount) private {
        address vestingPool = getVestingPool(account);
        bytes memory transferData = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            msg.sender,
            vestingPool,
            amount
        );
        require(
            ModuleManager(dao).execTransactionFromModule(address(token), 0, transferData, 0),
            "Module transaction failed"
        );
    }
}
