// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.22 <0.9.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title Test ERC20Votes token for vesting E2E tests on Gnosis Chiado.
/// @dev Compatible with VestingPoolManager (has paused() returning false).
contract TestToken is ERC20Votes {
    address public immutable minter;

    constructor()
        ERC20("Test Vesting Token", "TVT")
        EIP712("Test Vesting Token", "1")
    {
        minter = msg.sender;
        _mint(msg.sender, 10_000_000 * 1e18);
    }

    /// @dev ShutterToken compatibility – VestingPoolManager calls token.paused()
    function paused() external pure returns (bool) {
        return false;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "Only minter");
        _mint(to, amount);
    }
}
