// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TonneLedger
/// @notice One retired tonne can back one claim. Each registry retirement (a row in the
/// CarbonPlan OffsetsDB snapshot named by `datasetHash`) gets a cap equal to the tonnes it retired.
/// When a checked report is anchored, its claimant takes tonnes from those rows. If another claimant
/// already holds them, the contract refuses that row and records the refusal as an event.
/// Amounts are in milli-tonnes CO2e (1 t = 1000).
contract TonneLedger {
    address public immutable attester;
    bytes32 public immutable datasetHash;

    struct Row {
        uint128 cap;
        uint128 used;
    }

    mapping(uint64 => Row) public rows;
    /// rowId => claimant => milli-tonnes that claimant holds on that row
    mapping(uint64 => mapping(bytes32 => uint128)) public held;
    /// reportHash => block number it was anchored in (0 = never)
    mapping(bytes32 => uint256) public anchoredAt;

    event ReportAnchored(bytes32 indexed reportHash, bytes32 indexed claimant, uint256 rowsClaimed, uint256 rowsBlocked, uint256 milliTonnes);
    event TonnesClaimed(uint64 indexed rowId, bytes32 indexed claimant, bytes32 indexed reportHash, uint128 milliTonnes, uint128 rowUsed, uint128 rowCap);
    event DoubleClaimBlocked(uint64 indexed rowId, bytes32 indexed claimant, bytes32 indexed reportHash, uint128 requested, uint128 heldByOthers, uint128 rowCap);

    error NotAttester();
    error AlreadyAnchored(bytes32 reportHash);
    error LengthMismatch();
    error CapMismatch(uint64 rowId, uint128 stored, uint128 given);
    error ZeroCap(uint64 rowId);

    constructor(address attester_, bytes32 datasetHash_) {
        attester = attester_;
        datasetHash = datasetHash_;
    }

    /// @param reportHash SHA-256 of the canonical report JSON
    /// @param claimant keccak256 of the normalized claimant name
    /// @param rowIds retirement row IDs from the snapshot
    /// @param caps tonnes each row retired, in milli-tonnes (fixed on first use)
    /// @param amounts milli-tonnes this report takes from each row
    function anchor(
        bytes32 reportHash,
        bytes32 claimant,
        uint64[] calldata rowIds,
        uint128[] calldata caps,
        uint128[] calldata amounts
    ) external {
        if (msg.sender != attester) revert NotAttester();
        if (anchoredAt[reportHash] != 0) revert AlreadyAnchored(reportHash);
        if (rowIds.length != caps.length || rowIds.length != amounts.length) revert LengthMismatch();
        anchoredAt[reportHash] = block.number;

        uint256 claimedRows;
        uint256 blockedRows;
        uint256 total;
        for (uint256 i; i < rowIds.length; ++i) {
            uint64 id = rowIds[i];
            if (caps[i] == 0) revert ZeroCap(id);
            Row storage r = rows[id];
            if (r.cap == 0) r.cap = caps[i];
            else if (r.cap != caps[i]) revert CapMismatch(id, r.cap, caps[i]);

            uint128 mine = held[id][claimant];
            uint128 others = r.used - mine;
            // A claimant re-checking the same claim keeps its share; it is not counted twice.
            uint128 want = amounts[i] > mine ? amounts[i] : mine;
            if (others + want > r.cap) {
                ++blockedRows;
                emit DoubleClaimBlocked(id, claimant, reportHash, amounts[i], others, r.cap);
                continue;
            }
            held[id][claimant] = want;
            r.used = others + want;
            ++claimedRows;
            total += amounts[i];
            emit TonnesClaimed(id, claimant, reportHash, amounts[i], r.used, r.cap);
        }
        emit ReportAnchored(reportHash, claimant, claimedRows, blockedRows, total);
    }

    /// @notice What a claimant could still take from a row.
    function available(uint64 rowId, bytes32 claimant) external view returns (uint128 cap, uint128 heldByOthers, uint128 mine) {
        Row memory r = rows[rowId];
        mine = held[rowId][claimant];
        return (r.cap, r.used - mine, mine);
    }
}
