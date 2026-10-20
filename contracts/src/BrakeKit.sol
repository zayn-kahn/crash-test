// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Pulls Brake's contracts into this build so `contracts/out/` holds their artifacts for the harness
// (src/chain/deploy.ts). Nothing is defined here.
import {Brake} from "brake/Brake.sol";
import {DemoAccount} from "brake/demo/DemoAccount.sol";
import {DemoDollar} from "brake/demo/DemoDollar.sol";
