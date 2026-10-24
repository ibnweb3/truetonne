// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TonneLedger} from "../src/TonneLedger.sol";

contract TonneLedgerTest is Test {
    TonneLedger ledger;
    address attester = address(0xA11CE);
    bytes32 kinaxis = keccak256("kinaxis");
    bytes32 climeco = keccak256("climeco");

    event DoubleClaimBlocked(uint64 indexed rowId, bytes32 indexed claimant, bytes32 indexed reportHash, uint128 requested, uint128 heldByOthers, uint128 rowCap);

    function setUp() public {
        ledger = new TonneLedger(attester, bytes32(uint256(1)));
    }

    function _one(uint64 id, uint128 cap, uint128 amt) internal pure returns (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) {
        ids = new uint64[](1);
        caps = new uint128[](1);
        amts = new uint128[](1);
        ids[0] = id;
        caps[0] = cap;
        amts[0] = amt;
    }

    function test_firstClaimTakesTonnes() public {
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(316960, 5_000_000, 5_000_000);
        vm.prank(attester);
        ledger.anchor(keccak256("r1"), kinaxis, ids, caps, amts);
        (uint128 cap, uint128 others, uint128 mine) = ledger.available(316960, kinaxis);
        assertEq(cap, 5_000_000);
        assertEq(others, 0);
        assertEq(mine, 5_000_000);
        assertEq(ledger.anchoredAt(keccak256("r1")), block.number);
    }

    function test_secondClaimantIsBlocked() public {
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(316960, 5_000_000, 5_000_000);
        vm.startPrank(attester);
        ledger.anchor(keccak256("r1"), kinaxis, ids, caps, amts);
        vm.expectEmit(true, true, true, true);
        emit DoubleClaimBlocked(316960, climeco, keccak256("r2"), 5_000_000, 5_000_000, 5_000_000);
        ledger.anchor(keccak256("r2"), climeco, ids, caps, amts);
        vm.stopPrank();
        (, , uint128 mine) = ledger.available(316960, climeco);
        assertEq(mine, 0);
        (uint128 cap, uint128 used) = ledger.rows(316960);
        assertEq(used, cap);
    }

    function test_splitRowBetweenClaimantsUpToCap() public {
        vm.startPrank(attester);
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(7, 10_000, 6_000);
        ledger.anchor(keccak256("a"), kinaxis, ids, caps, amts);
        amts[0] = 4_000;
        ledger.anchor(keccak256("b"), climeco, ids, caps, amts);
        (, uint128 used) = ledger.rows(7);
        assertEq(used, 10_000);
        amts[0] = 1;
        ledger.anchor(keccak256("c"), keccak256("third"), ids, caps, amts);
        vm.stopPrank();
        (, , uint128 mine) = ledger.available(7, keccak256("third"));
        assertEq(mine, 0);
    }

    function test_sameClaimantRecheckIsNotDoubleCounted() public {
        vm.startPrank(attester);
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(7, 10_000, 10_000);
        ledger.anchor(keccak256("a"), kinaxis, ids, caps, amts);
        ledger.anchor(keccak256("a2"), kinaxis, ids, caps, amts);
        vm.stopPrank();
        (, uint128 used) = ledger.rows(7);
        assertEq(used, 10_000);
    }

    function test_onlyAttester() public {
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(7, 10, 10);
        vm.expectRevert(TonneLedger.NotAttester.selector);
        ledger.anchor(keccak256("x"), kinaxis, ids, caps, amts);
    }

    function test_reportCannotBeAnchoredTwice() public {
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(7, 10, 10);
        vm.startPrank(attester);
        ledger.anchor(keccak256("x"), kinaxis, ids, caps, amts);
        vm.expectRevert(abi.encodeWithSelector(TonneLedger.AlreadyAnchored.selector, keccak256("x")));
        ledger.anchor(keccak256("x"), kinaxis, ids, caps, amts);
        vm.stopPrank();
    }

    function test_capCannotChange() public {
        vm.startPrank(attester);
        (uint64[] memory ids, uint128[] memory caps, uint128[] memory amts) = _one(7, 10, 5);
        ledger.anchor(keccak256("x"), kinaxis, ids, caps, amts);
        caps[0] = 20;
        vm.expectRevert(abi.encodeWithSelector(TonneLedger.CapMismatch.selector, uint64(7), uint128(10), uint128(20)));
        ledger.anchor(keccak256("y"), climeco, ids, caps, amts);
        vm.stopPrank();
    }

    function test_reportOnlyHashNoRows() public {
        vm.prank(attester);
        ledger.anchor(keccak256("empty"), kinaxis, new uint64[](0), new uint128[](0), new uint128[](0));
        assertGt(ledger.anchoredAt(keccak256("empty")), 0);
    }
}
