/**
 * payment.ts — paid notarize via @x402/fetch (challenge → EIP-3009 sign → retry).
 *
 * Real installed surface (verified in node_modules, @x402/fetch 2.28.0 +
 * @x402/evm 2.28.0):
 *   x402Client from "@x402/core/client"
 *   registerExactEvmScheme from "@x402/evm/exact/client"   ← root index does
 *     NOT re-export it; the README example points at ".../exact/client/register"
 *     which does not exist in the package exports of 2.28.0 — use ./exact/client.
 *   toClientEvmSigner from "@x402/evm"
 *   privateKeyToAccount from "viem/accounts"
 *   wrapFetchWithPayment from "@x402/fetch"
 *
 * The private key comes from env AOTRUST_EVM_PRIVATE_KEY and flows only into
 * the viem signer factory — it is NEVER printed, logged, or embedded in error
 * messages (a missing key produces a plain instruction, never the value).
 */
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  AOTRUST_EVM_PRIVATE_KEY_ENV,
  USER_AGENT,
} from "./env.js";

export type PaidResult = {
  status: number;
  body: unknown;
};

export class PaymentConfigError extends Error {
  readonly code = "MISSING_PRIVATE_KEY";
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigError";
  }
}

/**
 * Build the x402 fetch wrapper once per process (lazy).
 * Returns a fetch-like callable: POST → 402 challenge → EIP-3009 sign →
 * retry with x-payment header — all inside the wrapper.
 */
let _paidFetch: typeof fetch | null = null;
export async function buildPaidFetch(): Promise<typeof fetch> {
  if (_paidFetch) {
    return _paidFetch;
  }
  const keyEnv = process.env[AOTRUST_EVM_PRIVATE_KEY_ENV];
  if (!keyEnv || keyEnv.trim().length === 0) {
    throw new PaymentConfigError(
      "set AOTRUST_EVM_PRIVATE_KEY (EVM wallet private key, 0x-prefixed) to use notary_notarize",
    );
  }

  const account = privateKeyToAccount(trimKey(keyEnv));
  const signer = toClientEvmSigner(account);
  const client = new x402Client();
  // Base mainnet = eip155:8453 — the ONLY paid rail in v0.1 (HTTP /notarize
  // is Base by server design; Solana = remote-MCP-only, see README).
  registerExactEvmScheme(client, { signer });

  _paidFetch = wrapFetchWithPayment(globalThis.fetch, client);
  return _paidFetch;
}

/** Strip whitespace/quotes; never echo the value. */
function trimKey(raw: string): `0x${string}` {
  let k = raw.trim().replace(/^["']|["']$/g, "");
  if (!k.startsWith("0x")) {
    k = `0x${k}`;
  }
  return k as `0x${string}`;
}

/** Test seam: reset the cached wrapper (tests never hold a real key). */
export function resetPaidFetchCache(): void {
  _paidFetch = null;
}

/** One paid POST against {base}/notarize. Response passed through verbatim. */
export async function paidPost(
  baseUrl: string,
  body: Record<string, unknown>,
  fetchFn?: typeof fetch,
): Promise<PaidResult> {
  const paidFetch = fetchFn ?? (await buildPaidFetch());
  const res = await paidFetch(`${baseUrl}/notarize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
      string,
      unknown
    >;
    const code =
      typeof obj["error"] === "string" ? obj["error"] : `HTTP_${res.status}`;
    throw Object.assign(new Error(code), {
      name: "ApiError",
      status: res.status,
      code,
      body: parsed,
    });
  }
  return { status: res.status, body: parsed };
}