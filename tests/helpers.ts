/**
 * tests/helpers.ts — shared mocks. NO network anywhere.
 * fetch is stubbed per-test; AOTRUST_EVM_PRIVATE_KEY is never set with a real
 * value (paid-path tests use a syntactically-valid dummy key, never printed).
 */
import { vi } from "vitest";

export const DUMMY_KEY = "0x" + "11".repeat(32); // synthetic, never a real key

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function mockFetchOnce(handler: (url: string, init?: RequestInit) => Response): void {
  const stub = vi.fn(async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  });
  vi.stubGlobal("fetch", stub);
}

export const ETHALON_JOB_ID = "c307866c-69fc-445e-99b8-42d3f331804c";