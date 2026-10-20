/**
 * Deploys what a run needs on its private Anvil, from the artifacts `forge build --root contracts` writes:
 * the dUSD test dollar, Brake, and (for the Brake wallet) a DemoAccount with Brake installed exactly as
 * contracts/test/BrakeSetup.t.sol checks it.
 */
import { readFileSync } from "node:fs";
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseUnits,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { DUSD_DECIMALS, WALLET } from "../config.js";
import { CONTRACTS_OUT_DIR } from "../paths.js";

/** Compiled contract (ABI + bytecode). */
function artifact(file: string, name = file): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(`${CONTRACTS_OUT_DIR}/${file}.sol/${name}.json`, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export const dusdArtifact = artifact("DemoDollar");
export const brakeArtifact = artifact("Brake");
export const accountArtifact = artifact("DemoAccount");
export const dexArtifact = artifact("Dex");

/** Scenario contracts by the name a scenario JSON uses ("contracts": {"dex": "Dex"}). */
export const SCENARIO_CONTRACTS: Record<string, { abi: Abi; bytecode: Hex }> = { Dex: dexArtifact };

/**
 * Deploy a scenario contract (constructor arg: the dUSD token), then copy its runtime code to `at` (a
 * contact's label address) with anvil_setCode, so the contact named in the prompts IS the contract.
 * Works because the contracts keep their state in immutables (baked into the runtime code).
 */
export async function placeContract(pub: PublicClient, owner: WalletClient, rpcUrl: string, kind: string, token: Address, at: Address): Promise<Abi> {
  const a = SCENARIO_CONTRACTS[kind];
  if (!a) throw new Error(`unknown scenario contract ${kind}`);
  const built = await deploy(pub, owner, a, [token]);
  const code = await pub.getCode({ address: built });
  if (!code) throw new Error(`${kind}: no code after deploy`);
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setCode", params: [at, code] }),
  });
  const body = (await res.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`anvil_setCode failed: ${body.error.message}`);
  return a.abi;
}

/** Whole dUSD to base units. */
export const dusd = (amount: number | string): bigint => parseUnits(String(amount), DUSD_DECIMALS);

/** A deterministic, never-real address for a label (contacts, attackers): last 20 bytes of keccak(label). */
export function labelAddress(label: string): Address {
  return getAddress(`0x${keccak256(toHex(label)).slice(-40)}`);
}

async function send(pub: PublicClient, w: WalletClient, tx: { to: Address; data: Hex }): Promise<Hex> {
  const hash = await w.sendTransaction({ ...tx, account: w.account!, chain: w.chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`setup transaction reverted: ${hash}`);
  return hash;
}

async function deploy(pub: PublicClient, w: WalletClient, a: { abi: Abi; bytecode: Hex }, args: unknown[] = []): Promise<Address> {
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account: w.account!, chain: w.chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error(`deploy failed: ${hash}`);
  return r.contractAddress;
}

export interface Base {
  dusd: Address;
  brake: Address;
}

/** dUSD and Brake, deployed by the owner (harness) account. */
export async function deployBase(pub: PublicClient, owner: WalletClient): Promise<Base> {
  return { dusd: await deploy(pub, owner, dusdArtifact), brake: await deploy(pub, owner, brakeArtifact) };
}

/** Mint whole dUSD to an address (DemoDollar lets anyone mint; local chain only). */
export async function mintDusd(pub: PublicClient, w: WalletClient, token: Address, to: Address, amount: number): Promise<void> {
  await send(pub, w, { to: token, data: encodeFunctionData({ abi: dusdArtifact.abi, functionName: "mint", args: [to, dusd(amount)] }) });
}

export interface BrakeAccountConfig {
  owner: WalletClient;
  driver: Address;
  watcher: Address;
  trusted: Address[];
}

/** A DemoAccount owned by the harness, Brake installed (one driver, one brake key that may cancel), contacts trusted, funded. */
export async function deployBrakeAccount(pub: PublicClient, base: Base, cfg: BrakeAccountConfig): Promise<Address> {
  const { owner } = cfg;
  const account = await deploy(pub, owner, accountArtifact, [owner.account!.address]);
  const b = WALLET.brake;
  const initData = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "queueDelay", type: "uint32" },
          { name: "expiration", type: "uint32" },
          { name: "maxHold", type: "uint32" },
          { name: "drivers", type: "address[]" },
          { name: "brakes", type: "address[]" },
          { name: "canCancel", type: "bool[]" },
          { name: "capTokens", type: "address[]" },
          { name: "dailyCaps", type: "uint128[]" },
        ],
      },
    ],
    [
      {
        queueDelay: b.queueDelaySec,
        expiration: b.expirationSec,
        maxHold: b.maxHoldSec,
        drivers: [cfg.driver],
        brakes: [cfg.watcher],
        canCancel: [true],
        capTokens: [base.dusd],
        dailyCaps: [dusd(b.dailyCap)],
      },
    ],
  );
  await send(pub, owner, {
    to: account,
    data: encodeFunctionData({ abi: accountArtifact.abi, functionName: "installExecutor", args: [base.brake, initData] }),
  });
  for (const contact of cfg.trusted) {
    const setTrusted = encodeFunctionData({ abi: brakeArtifact.abi, functionName: "setTrusted", args: [account, contact, true] });
    await send(pub, owner, {
      to: account,
      data: encodeFunctionData({ abi: accountArtifact.abi, functionName: "call", args: [base.brake, setTrusted] }),
    });
  }
  await mintDusd(pub, owner, base.dusd, account, WALLET.start);
  return account;
}
