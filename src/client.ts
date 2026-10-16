/**
 * client.ts — HTTP layer for the AOTrust API.
 *
 * Base URL comes from env AOTRUST_BASE_URL (default https://api.aotrust.link).
 * No host constants live in tool code — env-aware, same pattern as the server.
 *
 * URL-encoding contract (verified against the live API, 16.10):
 *   /v1/pdr/verify/{pdr_b64} expects Python quote_plus equivalents:
 *   '+' → %2B, '/' → %2F, '=' → '%3D'. The API regex tolerates the percent
 *   escapes; encodeURI/encodeURIComponent default sets are NOT sufficient
 *   (encodeURIComponent leaves '+' intact and encodes '/' as %2F — that part
 *   matches, but '+' must be escaped too because '+' in a URL path decodes
 *   to a space in some frontends).
 *
 * Everything about response bodies is passed through verbatim: the AOTrust
 * error fields (error / message / detail) are load-bearing for clients.
 */
import { AOTRUST_BASE_URL_ENV, DEFAULT_BASE_URL, INVALID_SHIELD_ID_ERR, INVALID_SHIELD_ID_MSG, USER_AGENT } from "./env.js";

export class ApiError extends Error {
  /** HTTP status of the failed call. */
  readonly status: number;
  /** Upstream error code, verbatim (never rephrased). */
  readonly code: string;
  /** Upstream raw body, verbatim JSON if parseable. */
  readonly body: unknown;

  constructor(status: number, code: string, body: unknown) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function getBaseUrl(): string {
  const env = process.env[AOTRUST_BASE_URL_ENV];
  const raw = env && env.trim().length > 0 ? env : DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/** quote_plus equivalent: '+' → %2B, '/' → %2F, '=' → %3D (percent-tolerant path). */
export function encodePdrB64(pdr_b64: string): string {
  return pdr_b64
    .replace(/\+/g, "%2B")
    .replace(/\//g, "%2F")
    .replace(/=/g, "%3D");
}

export type UpstreamResponse = {
  status: number;
  body: unknown;
};

async function requestJson(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<UpstreamResponse> {
  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    ...(extraHeaders ?? {}),
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, {
    method,
    headers,
    body: payload,
  });

  let parsed: unknown = null;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const code = typeof obj["error"] === "string" ? obj["error"] : `HTTP_${res.status}`;
    throw new ApiError(res.status, code, parsed);
  }
  return { status: res.status, body: parsed };
}

/** GET /v1/status/{job_id} — passthrough, never touched. */
export async function getStatus(jobId: string): Promise<UpstreamResponse> {
  return requestJson("GET", `/v1/status/${encodeURIComponent(jobId)}`);
}

/** GET /v1/pdr/verify/{pdr_b64} — pdr_b64 quote_plus-encoded. */
export async function verifyPdr(pdrB64: string): Promise<UpstreamResponse> {
  return requestJson("GET", `/v1/pdr/verify/${encodePdrB64(pdrB64)}`);
}

/**
 * GET /v1/shield/lookup/{shield_id} — shield_id must be EXACTLY 8 hex.
 * Non-conforming shape is rejected LOCALLY with the server's verbatim error
 * form (400/INVALID_SHIELD_ID/"Shield ID must be 8 hexadecimal characters")
 * — zero network for a call the server would reject anyway.
 */
export async function shieldLookup(shieldId: string): Promise<UpstreamResponse> {
  if (!/^[0-9a-fA-F]{8}$/.test(shieldId)) {
    throw new ApiError(400, INVALID_SHIELD_ID_ERR, {
      error: INVALID_SHIELD_ID_ERR,
      message: INVALID_SHIELD_ID_MSG,
    });
  }
  return requestJson("GET", `/v1/shield/lookup/${encodeURIComponent(shieldId)}`);
}

/** POST /v1/shield/free — body verbatim from the tool layer. */
export async function shieldFree(body: Record<string, unknown>): Promise<UpstreamResponse> {
  return requestJson("POST", "/v1/shield/free", body);
}
