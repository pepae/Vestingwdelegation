// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.22 <0.9.0;

library VestingLibrary {
    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(string name,string version)");

    bytes32 private constant VESTING_TYPEHASH =
        keccak256(
            "Vesting(address owner,uint8 curveType,bool managed,uint16 durationWeeks,uint64 startDate,uint128 amount,uint128 initialUnlock,bool requiresSPT)"
        );

    // Sane limits based on: https://eips.ethereum.org/EIPS/eip-1985
    // amountClaimed should always be equal to or less than amount
    // pausingDate should always be equal to or greater than startDate
    struct Vesting {
        // First storage slot
        uint128 initialUnlock; // 16 bytes -> Max 3.4e20 tokens (including decimals)
        uint8 curveType;       // 1 byte  -> Max 256 different curve types
        bool managed;          // 1 byte
        uint16 durationWeeks;  // 2 bytes -> Max 65536 weeks ~ 1260 years
        uint64 startDate;      // 8 bytes -> Works until year 292278994
        // Second storage slot
        uint128 amount;        // 16 bytes -> Max 3.4e20 tokens
        uint128 amountClaimed; // 16 bytes
        // Third storage slot
        uint64 pausingDate;    // 8 bytes
        bool cancelled;        // 1 byte
        bool requiresSPT;      // 1 byte
    }

    /// @notice Calculate the id for a vesting based on its parameters.
    function vestingHash(
        address owner,
        uint8 curveType,
        bool managed,
        uint16 durationWeeks,
        uint64 startDate,
        uint128 amount,
        uint128 initialUnlock,
        bool requiresSPT
    ) external pure returns (bytes32 vestingId) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_SEPARATOR_TYPEHASH, "VestingLibrary", "1.0")
        );
        bytes32 vestingDataHash = keccak256(
            abi.encode(
                VESTING_TYPEHASH,
                owner,
                curveType,
                managed,
                durationWeeks,
                startDate,
                amount,
                initialUnlock,
                requiresSPT
            )
        );
        vestingId = keccak256(
            abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, vestingDataHash)
        );
    }
}
