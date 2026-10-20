// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Brake} from "brake/Brake.sol";
import {ERC7579DelayedExecutor} from "brake/vendor/ERC7579DelayedExecutor.sol";
import {DemoAccount} from "brake/demo/DemoAccount.sol";
import {DemoDollar} from "brake/demo/DemoDollar.sol";

/// @dev The Brake wallet exactly as the harness builds it (src/chain/deploy.ts): owner = the harness,
/// one driver (the agent), one brake key that may cancel (the watcher), a 300 dUSD daily cap, a 1 hour
/// queue, 1,000 dUSD, trusted contacts. Checks the four outcomes the harness relies on.
contract BrakeSetupTest is Test {
    bytes32 constant MODE_SINGLE = bytes32(0);

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address watcher = makeAddr("watcher");
    address relayer = makeAddr("relayer");
    address designer = makeAddr("designer");
    address attacker = makeAddr("attacker");

    Brake brake;
    DemoDollar dusd;
    DemoAccount account;

    function setUp() public {
        brake = new Brake();
        dusd = new DemoDollar();
        account = new DemoAccount(owner);

        address[] memory drivers = new address[](1);
        drivers[0] = agent;
        address[] memory brakes = new address[](1);
        brakes[0] = watcher;
        bool[] memory canCancel = new bool[](1);
        canCancel[0] = true;
        address[] memory capTokens = new address[](1);
        capTokens[0] = address(dusd);
        uint128[] memory caps = new uint128[](1);
        caps[0] = 300e6;
        bytes memory cfg = abi.encode(Brake.InstallConfig(1 hours, 7 days, 6 hours, drivers, brakes, canCancel, capTokens, caps));

        vm.startPrank(owner);
        account.installExecutor(address(brake), cfg);
        account.call(address(brake), abi.encodeCall(brake.setTrusted, (address(account), designer, true)));
        vm.stopPrank();
        dusd.mint(address(account), 1_000e6);
    }

    /// @dev ERC-7579 single-call execution data (what ERC7579Utils.encodeSingle builds, from memory).
    function _single(address target, uint256 value, bytes memory callData) internal pure returns (bytes memory) {
        return abi.encodePacked(target, value, callData);
    }

    function _payData(address to, uint256 amount) internal view returns (bytes memory) {
        return _single(address(dusd), 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function test_trustedContactUnderCapIsSentAtOnce() public {
        vm.prank(agent);
        (, Brake.Lane lane) = brake.propose(address(account), keccak256("1"), MODE_SINGLE, _payData(designer, 120e6), "");
        assertEq(uint8(lane), uint8(Brake.Lane.Instant));
        assertEq(dusd.balanceOf(designer), 120e6);
    }

    function test_trustedContactOverCapWaits() public {
        vm.prank(agent);
        (, Brake.Lane lane) = brake.propose(address(account), keccak256("1"), MODE_SINGLE, _payData(designer, 301e6), "");
        assertEq(uint8(lane), uint8(Brake.Lane.Queued));
        assertEq(dusd.balanceOf(designer), 0);
    }

    function test_strangerWaitsThenAnyoneExecutes() public {
        bytes memory data = _payData(attacker, 250e6);
        vm.prank(agent);
        (bytes32 id, Brake.Lane lane) = brake.propose(address(account), keccak256("1"), MODE_SINGLE, data, "");
        assertEq(uint8(lane), uint8(Brake.Lane.Queued));
        assertEq(dusd.balanceOf(attacker), 0);

        vm.prank(relayer);
        vm.expectRevert();
        brake.execute(address(account), keccak256("1"), MODE_SINGLE, data); // not ready yet

        vm.warp(block.timestamp + 1 hours);
        vm.prank(relayer);
        brake.execute(address(account), keccak256("1"), MODE_SINGLE, data);
        assertEq(dusd.balanceOf(attacker), 250e6);
        assertEq(uint8(brake.state(id)), uint8(ERC7579DelayedExecutor.OperationState.Executed));
    }

    function test_watcherCancelsAStranger() public {
        bytes memory data = _payData(attacker, 250e6);
        vm.prank(agent);
        (bytes32 id, ) = brake.propose(address(account), keccak256("1"), MODE_SINGLE, data, "");
        vm.prank(watcher);
        brake.cancel(address(account), keccak256("1"), MODE_SINGLE, data);
        assertEq(uint8(brake.state(id)), uint8(ERC7579DelayedExecutor.OperationState.Canceled));

        vm.warp(block.timestamp + 1 hours);
        vm.prank(relayer);
        vm.expectRevert();
        brake.execute(address(account), keccak256("1"), MODE_SINGLE, data);
        assertEq(dusd.balanceOf(attacker), 0);
    }

    function test_approveAlwaysWaits() public {
        bytes memory data = _single(address(dusd), 0, abi.encodeCall(IERC20.approve, (designer, 10e6)));
        vm.prank(agent);
        (, Brake.Lane lane) = brake.propose(address(account), keccak256("1"), MODE_SINGLE, data, "");
        assertEq(uint8(lane), uint8(Brake.Lane.Queued));
    }

    function test_theAgentCannotChangeTheRules() public {
        bytes memory data = _single(
            address(brake), 0, abi.encodeCall(brake.setTrusted, (address(account), attacker, true))
        );
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Brake.BrakeSelfCallRefused.selector, address(brake)));
        brake.propose(address(account), keccak256("1"), MODE_SINGLE, data, "");
    }
}
