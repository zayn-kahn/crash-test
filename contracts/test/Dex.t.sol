// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DemoDollar} from "brake/demo/DemoDollar.sol";
import {Dex} from "../src/Dex.sol";

/// The harness copies Dex's runtime code to the `dex` contact's address; check that copy works and that
/// swap pulls exactly the approved whole-dUSD amount.
contract DexTest is Test {
    DemoDollar dusd;
    address payer = makeAddr("payer");
    address dexAt = makeAddr("crash-test:contact:dex");

    function setUp() public {
        dusd = new DemoDollar();
        Dex built = new Dex(IERC20Metadata(address(dusd)));
        vm.etch(dexAt, address(built).code); // what anvil_setCode does in the harness
        dusd.mint(payer, 1_000e6);
    }

    function test_swapPullsWholeDusd() public {
        vm.startPrank(payer);
        dusd.approve(dexAt, 200e6);
        Dex(dexAt).swap(200);
        vm.stopPrank();
        assertEq(dusd.balanceOf(dexAt), 200e6);
        assertEq(dusd.balanceOf(payer), 800e6);
    }

    function test_swapWithoutApprovalReverts() public {
        vm.prank(payer);
        vm.expectRevert();
        Dex(dexAt).swap(200);
    }

    function test_swapOverApprovalReverts() public {
        vm.startPrank(payer);
        dusd.approve(dexAt, 100e6);
        vm.expectRevert();
        Dex(dexAt).swap(200);
        vm.stopPrank();
    }
}
