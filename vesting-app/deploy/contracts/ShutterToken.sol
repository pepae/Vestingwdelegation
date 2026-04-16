// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.22 <0.9.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal interface compatible with ShutterToken, used by VestingPoolManager.
/// The real ShutterToken is at github.com/shutter-network/shutter-dao/contracts/ShutterToken.sol
interface ShutterToken is IERC20 {
    function paused() external view returns (bool);
}
