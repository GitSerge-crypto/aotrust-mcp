/**
 * tests/client.test.ts — HTTP layer, fetch fully mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  encodePdrB64,
  getStatus,
  getBaseUrl,
  shieldFree,
  shieldLookup,
  verifyPdr,
} from "../src/client.js";
import { jsonResponse, mockFetchOnce } from "./helpers.js";

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AOTRUST_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.AOTRUST_BASE_URL;
});

describe("base url", () => {
  it("defaults to https://api.aotrust.link", () => {
    delete process.env.AOTRUST_BASE_URL;
    expect(getBaseUrl()).toBe("https://api.aotrust.link");
  });

  it("honours AOTRUST_BASE_URL and strips trailing slashes", () => {
    process.env.AOTRUST_BASE_URL = "https://mirror.example.org///";
    expect(getBaseUrl()).toBe("https://mirror.example.org");
  });
});

describe("encodePdrB64 (quote_plus equivalent)", () => {
  it("maps + to %2B", () => {
    expect(encodePdrB64("AA+BB")).toBe("AA%2BBB");
  });
  it("maps / to %2F", () => {
    expect(encodePdrB64("AA/BB")).toBe("AA%2FBB");
  });
  it("maps = to %3D (padding)", () => {
    // Real 239-byte PDR base64 always carries '=' padding — every char must go.
    expect(encodePdrB64("ABC=")).toBe("ABC%3D");
  });
  it("maps a realistic fragment with all three", () => {
    const fragment = "Ab+/12==";
    expect(encodePdrB64(fragment)).toBe("Ab%2B%2F12%3D%3D");
  });

  it("verify URL uses the encoded b64 in the path", async () => {
    let captured = "";
    mockFetchOnce((url) => {
      captured = url;
      return jsonResponse(200, { sig_valid: true });
    });
    await verifyPdr("AA+/12==");
    expect(captured).toBe(
      "https://api.aotrust.link/v1/pdr/verify/AA%2B%2F12%3D%3D",
    );
  });
});

describe("status passthrough", () => {
  it("returns the upstream body verbatim, including nested result", async () => {
    const upstream = {
      status: "anchored",
      result: {
        pdr_b64: "QUJD+DE=/FGH",
        payment_hash: "c5ee21ab",
        near_anchor_tx: "tx123",
      },
    };
    mockFetchOnce(() => jsonResponse(200, upstream));
    const { body } = await getStatus("c307866c-69fc-445e-99b8-42d3f331804c");
    expect(body).toEqual(upstream); // deep-equal: nothing invented, nothing dropped
  });

  it("pending status passes pdr-less result as-is", async () => {
    const upstream = { status: "pending", result: {} };
    mockFetchOnce(() => jsonResponse(200, upstream));
    const { body } = await getStatus("job-1");
    expect((body as { result: Record<string, unknown> }).result).toEqual({});
  });
});

describe("shield lookup guard", () => {
  it("builds GET /v1/shield/lookup/{8hex} for valid ids", async () => {
    let captured = "";
    mockFetchOnce((url) => {
      captured = url;
      return jsonResponse(200, {
        found: true,
        shield_id: "aa12bb34",
        pdr_b64: "QUJD",
        payment_hash: "c5ee21ab",
        timestamp_utc: "2026-10-16T12:00:00Z",
        near_anchor_tx: null,
      });
    });
    await shieldLookup("aa12bb34");
    expect(captured).toBe("https://api.aotrust.link/v1/shield/lookup/aa12bb34");
  });

  it("rejects non-8hex locally with the server's exact error form", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await shieldLookup("short");
      expect.fail("must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(400);
      expect((e as ApiError).code).toBe("INVALID_SHIELD_ID");
      expect((e as ApiError).body).toEqual({
        error: "INVALID_SHIELD_ID",
        message: "Shield ID must be 8 hexadecimal characters",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled(); // zero network for bad shape
  });
});

describe("shield free", () => {
  it("POSTs the body verbatim to /v1/shield/free", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    mockFetchOnce((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, {
        status: "ok",
        shield_id: "aa12bb34",
        pdr_b64: "QUJD",
        tier: "free",
        payment_anchor_type: "UNPAID",
      });
    });
    const { body } = await shieldFree({ work_hash: "9".repeat(64) });
    expect(capturedUrl).toBe("https://api.aotrust.link/v1/shield/free");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(capturedInit?.body as string)).toEqual({ work_hash: "9".repeat(64) });
    expect((body as { shield_id: string }).shield_id).toBe("aa12bb34");
  });

  it("passes 429 FREE_TIER_LIMIT_REACHED through with NO retry", async () => {
    const fetchSpy = vi.fn(() =>
      jsonResponse(429, { error: "FREE_TIER_LIMIT_REACHED", message: "Free limit reached" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await shieldFree({ work_hash: "9".repeat(64) });
      expect.fail("must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(429);
      expect((e as ApiError).code).toBe("FREE_TIER_LIMIT_REACHED");
      expect((e as ApiError).body).toEqual({
        error: "FREE_TIER_LIMIT_REACHED",
        message: "Free limit reached",
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1); // quota is honest: one call, no retry
  });

  it("passes 422 INVALID_AGENT_SIGNATURE through", async () => {
    mockFetchOnce(() =>
      jsonResponse(422, { error: "INVALID_AGENT_SIGNATURE", message: "sig_A does not match agent_pubkey for work_hash" }),
    );
    try {
      await shieldFree({ work_hash: "9".repeat(64), agent_sig: "sig", agent_pubkey: "ff" });
      expect.fail("must throw");
    } catch (e) {
      expect((e as ApiError).code).toBe("INVALID_AGENT_SIGNATURE");
    }
  });
});