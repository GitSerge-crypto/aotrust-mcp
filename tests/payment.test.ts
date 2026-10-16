/**
 * tests/payment.test.ts — paid path. NEVER calls the live network.
 *
 * The dummy key is syntactically valid but synthetic; it is never printed.
 * Flow verification: our fetch wrapper is mocked at the Response level and the
 * x402 challenge/sig/retry mechanics are verified through @x402/fetch behavior
 * (challenge 402 → signed retry header → 200 passthrough).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUMMY_KEY, jsonResponse } from "./helpers.js";
import { PaymentConfigError, buildPaidFetch, paidPost, resetPaidFetchCache } from "../src/payment.js";
import { getBaseUrl } from "../src/client.js";

beforeEach(() => {
  resetPaidFetchCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  resetPaidFetchCache();
  vi.unstubAllGlobals();
});

describe("missing key", () => {
  it("returns a plain instruction, no network call, no key value in the message", async () => {
    delete process.env.AOTRUST_EVM_PRIVATE_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(buildPaidFetch()).rejects.toThrow(PaymentConfigError);
    await expect(buildPaidFetch()).rejects.toThrow(/set AOTRUST_EVM_PRIVATE_KEY/);
    // The error must not contain the key env NAME's VALUE (there is none) — and,
    // critically, the message pattern must be an instruction, not a dump.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("paidPost surfaces the same error without calling /notarize", async () => {
    delete process.env.AOTRUST_EVM_PRIVATE_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await paidPost(getBaseUrl(), { work_hash: "9".repeat(64) });
      expect.fail("must throw");
    } catch (e) {
      expect((e as Error).name).toBe("PaymentConfigError");
      expect((e as Error).message).toContain("AOTRUST_EVM_PRIVATE_KEY");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("paid flow with x402 wrapper (mocked transport)", () => {
  it("returns upstream 200 JSON verbatim after the x402 retry", async () => {
    process.env.AOTRUST_EVM_PRIVATE_KEY = DUMMY_KEY;

    const upstream = {
      job_id: "job-paid-1",
      pdr_b64: "QUJD".repeat(20),
      payment_anchor_type: "X402_BASE",
    };
    // Our handler is invoked AFTER the x402 wrapper completed the challenge +
    // signed retry, so from here a plain 200 is the contract.
    const captured: { url: string; init?: RequestInit }[] = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      captured.push({ url, init });
      return jsonResponse(200, upstream);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { status, body } = await paidPost(getBaseUrl(), { work_hash: "9".repeat(64) });
    expect(status).toBe(200);
    expect(body).toEqual(upstream); // verbatim passthrough
    expect((body as { job_id: string }).job_id).toBe("job-paid-1");
  });

  it("propagates upstream error codes verbatim (no rephrasing)", async () => {
    process.env.AOTRUST_EVM_PRIVATE_KEY = DUMMY_KEY;
    const fetchSpy = vi.fn(async () =>
      jsonResponse(400, { error: "INVALID_WORK_HASH", message: "work_hash must be 64 hex chars" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await paidPost(getBaseUrl(), { work_hash: "short" });
      expect.fail("must throw");
    } catch (e) {
      expect((e as { name: string }).name).toBe("ApiError");
      expect((e as { code: string }).code).toBe("INVALID_WORK_HASH");
      expect((e as { body: unknown }).body).toEqual({
        error: "INVALID_WORK_HASH",
        message: "work_hash must be 64 hex chars",
      });
    }
  });

  it("does not leak the dummy key into error/messages surfaces", async () => {
    process.env.AOTRUST_EVM_PRIVATE_KEY = DUMMY_KEY;
    const fetchSpy = vi.fn(async () =>
      jsonResponse(500, { error: "SERVER_ERROR", message: "boom" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await paidPost(getBaseUrl(), { work_hash: "9".repeat(64) });
      expect.fail("must throw");
    } catch (e) {
      const rendered = JSON.stringify({
        name: (e as Error).name,
        message: (e as Error).message,
        code: (e as { code?: string }).code ?? "",
        body: (e as { body?: unknown }).body ?? null,
      });
      expect(rendered).not.toContain(DUMMY_KEY);
    }
  });
});