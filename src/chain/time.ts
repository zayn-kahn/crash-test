/** Moves the private chain's clock (Anvil only). The Brake wait passes instantly; results report the configured wait. */
import { createTestClient, http } from "viem";
import { foundry } from "viem/chains";

export async function skipTime(rpcUrl: string, seconds: number): Promise<void> {
  const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpcUrl) });
  await test.increaseTime({ seconds });
  await test.mine({ blocks: 1 });
}
