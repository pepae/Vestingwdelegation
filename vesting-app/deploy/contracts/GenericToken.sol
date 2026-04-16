// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.22 <0.9.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title Generic ERC20Votes token for vesting tests on Gnosis Chiado.
/// @dev Open faucet: anyone can mint up to 100,000 GVT per call.
///      Implements paused() = false so VestingPoolManager always uses transferFrom path.
contract GenericToken is ERC20Votes {
    uint256 public constant FAUCET_CAP = 100_000 * 1e18;

    constructor()
        ERC20("Generic Vesting Token", "GVT")
        EIP712("Generic Vesting Token", "1")
    {
        _mint(msg.sender, 10_000_000 * 1e18);
    }

    /// @dev VestingPoolManager compatibility – always returns false so transferFrom path is used.
    function paused() external pure returns (bool) {
        return false;
    }

    /// @dev Open faucet for testnet use. Capped at FAUCET_CAP per call.
    function mint(address to, uint256 amount) external {
        require(amount <= FAUCET_CAP, "Exceeds faucet cap");
        _mint(to, amount);
    }
}
