/**
 * tools.ts — the five AOTrust MCP tools.
 *
 * Every tool returns the upstream JSON VERBATIM in structuredContent/content:
 * no invented fields, error codes passed through unmodified (clients parse
 * `error`). The only allowed addition is `verify_url` derived from an
 * already-present field.
 *
 * Network policy v0.1: paid notarize is Base-only (the HTTP /notarize rail is
 * Base by server design; Solana exists only on the remote MCP server, not here).
 */
import { z } from "zod";
import {
  ApiError,
  encodePdrB64,
  getBaseUrl,
  getStatus,
  shieldFree,
  shieldLookup,
  verifyPdr,
} from "./client.js";
import { paidPost } from "./payment.js";
import {
  INVALID_SHIELD_ID_ERR,
  INVALID_SHIELD_ID_MSG,
  USER_AGENT,
} from "./env.js";

export type ToolContent = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
};

const FREE_TIER_LIMIT_CODE = "FREE_TIER_LIMIT_REACHED";
const SHIELD_ID_HEX_RE = /^[0-9a-fA-F]{8}$/;

/** MCP tool content from an upstream response, verbatim body + error passthrough. */
function contentFromBody(body: unknown): ToolContent {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: body,
  };
}

export function contentFromError(e: unknown): ToolContent {
  if (e instanceof ApiError) {
    const bodyObj =
      e.body && typeof e.body === "object" && !Array.isArray(e.body)
        ? (e.body as Record<string, unknown>)
        : { error: e.code };
    // Verbatim upstream body (error/message/detail are load-bearing).
    return contentFromBody(bodyObj);
  }
  const message = e instanceof Error ? e.message : String(e);
  return contentFromBody({ error: "LOCAL_ERROR", message });
}

// ── tool #1: notary_status ────────────────────────────────────────────────────

export const NotaryStatusArgs = z.object({
  job_id: z.string().min(1).describe("Job id returned by a notarization call"),
});

export async function toolNotaryStatus(args: { job_id: string }): Promise<ToolContent> {
  const { status, body } = await getStatus(args.job_id);
  return contentFromBody(body);
}

// ── tool #2: notary_verify ───────────────────────────────────────────────────

export const NotaryVerifyArgs = z.object({
  pdr_b64: z.string().min(1).describe("PDR bundle in base64 (239 bytes)"),
});

export async function toolNotaryVerify(args: { pdr_b64: string }): Promise<ToolContent> {
  const { body } = await verifyPdr(args.pdr_b64);
  return contentFromBody(body);
}

// ── tool #3: notary_lookup ───────────────────────────────────────────────────

export const NotaryLookupArgs = z.object({
  shield_id: z
    .string()
    .regex(SHIELD_ID_HEX_RE)
    .describe("Shield ID — exactly 8 hexadecimal characters"),
});

export async function toolNotaryLookup(args: { shield_id: string }): Promise<ToolContent> {
  if (!SHIELD_ID_HEX_RE.test(args.shield_id)) {
    // Local guard mirrors the server response form verbatim (throw, not return:
    // the registration layer maps thrown ApiError → isError reply). Zero network
    // for a shape the server would reject anyway.
    throw new ApiError(400, INVALID_SHIELD_ID_ERR, {
      error: INVALID_SHIELD_ID_ERR,
      message: INVALID_SHIELD_ID_MSG,
    });
  }
  const { body } = await shieldLookup(args.shield_id);
  return contentFromBody(body);
}

// ── tool #4: notary_free ─────────────────────────────────────────────────────

export const NotaryFreeArgs = z
  .object({
    work_hash: z
      .string()
      .optional()
      .describe("SHA-256 hex (64 chars) of the artifact — Mode A"),
    content: z
      .string()
      .optional()
      .describe("Raw text/code up to 60KB — Mode B (server hashes it, zero retention)"),
    agent_sig: z.string().optional().describe("Optional base64 Ed25519 signature (bilateral)"),
    agent_pubkey: z.string().optional().describe("Optional hex Ed25519 public key (bilateral)"),
  })
  .refine((v) => Boolean(v.work_hash) !== Boolean(v.content), {
    message: "exactly one of work_hash or content is required",
  });

export async function toolNotaryFree(
  args: z.infer<typeof NotaryFreeArgs>,
): Promise<ToolContent> {
  const body: Record<string, unknown> = {};
  if (args.work_hash !== undefined && args.work_hash !== "") {
    body["work_hash"] = args.work_hash;
  }
  if (args.content !== undefined && args.content !== "") {
    body["content"] = args.content;
  }
  if (args.agent_sig) {
    body["agent_sig"] = args.agent_sig;
  }
  if (args.agent_pubkey) {
    body["agent_pubkey"] = args.agent_pubkey;
  }
  const { body: upstream } = await shieldFree(body);
  if (typeof upstream === "object" && upstream !== null) {
    const rec = upstream as Record<string, unknown>;
    const workHash = typeof rec["work_hash"] === "string" ? rec["work_hash"] : null;
    if (workHash && (workHash.length === 64 || workHash.length === 66)) {
      // Allowed additive field: derived from an already-present work_hash.
      rec["verify_url"] = `https://verify.aotrust.link/s/${workHash.slice(0, 8)}`;
    }
  }
  return contentFromBody(upstream);
}

// ── tool #5: notary_notarize (PAID, x402 over HTTP) ─────────────────────────

export const NotaryNotarizeArgs = z
  .object({
    work_hash: z
      .string()
      .optional()
      .describe("SHA-256 hex (64 chars) of the artifact — Mode A"),
    content: z
      .string()
      .optional()
      .describe("Raw text/code up to 60KB — Mode B (server hashes it)"),
    agent_sig: z.string().optional().describe("Optional base64 Ed25519 signature (bilateral)"),
    agent_pubkey: z.string().optional().describe("Optional hex Ed25519 public key (bilateral)"),
  })
  .refine((v) => Boolean(v.work_hash) !== Boolean(v.content), {
    message: "exactly one of work_hash or content is required",
  });

export async function toolNotaryNotarize(
  args: z.infer<typeof NotaryNotarizeArgs>,
): Promise<ToolContent> {
  const body: Record<string, unknown> = {};
  if (args.work_hash !== undefined && args.work_hash !== "") {
    body["work_hash"] = args.work_hash;
  }
  if (args.content !== undefined && args.content !== "") {
    body["content"] = args.content;
  }
  if (args.agent_sig) {
    body["agent_sig"] = args.agent_sig;
  }
  if (args.agent_pubkey) {
    body["agent_pubkey"] = args.agent_pubkey;
  }
  // x402 wrapper handles: 402 challenge → EIP-3009 sign → retry with x-payment.
  // No facilitator client-side. Key comes from env, never logged.
  const { body: upstream } = await paidPost(getBaseUrl(), body);
  return contentFromBody(upstream);
}

// ── tool specs (--tools output; single source of truth with index.ts) ─────────

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: unknown;
  read_only: boolean;
  env_notes?: string;
};

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "notary_status",
    description:
      "Check notarization status by job_id. Free. GET /v1/status/{job_id}. Upstream JSON passthrough (status, result.pdr_b64, result.payment_hash, ...).",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string", description: "Job id from notarization response" } },
      required: ["job_id"],
    },
    read_only: true,
  },
  {
    name: "notary_verify",
    description:
      "Full server-side PDR verification by base64 bundle. Free. GET /v1/pdr/verify/{pdr_b64} (the b64 is quote_plus-encoded in the URL path).",
    inputSchema: {
      type: "object",
      properties: { pdr_b64: { type: "string", description: "PDR bundle in base64" } },
      required: ["pdr_b64"],
    },
    read_only: true,
  },
  {
    name: "notary_lookup",
    description:
      "Find a notarization record by Shield ID (8 hex chars returned by the free tier). Free. Local 8-hex guard mirrors the server 400 INVALID_SHIELD_ID form.",
    inputSchema: {
      type: "object",
      properties: { shield_id: { type: "string", description: "8 hex characters" } },
      required: ["shield_id"],
    },
    read_only: true,
  },
  {
    name: "notary_free",
    description:
      "Free UNPAID notarization (PDR proof-of-existence, no wallet). Rate limited 5/IP/24h (429 FREE_TIER_LIMIT_REACHED is quota, not a defect). Pass work_hash OR content.",
    inputSchema: {
      type: "object",
      properties: {
        work_hash: { type: "string", description: "sha256 hex (64 chars)" },
        content: { type: "string", description: "raw text/code ≤60KB" },
        agent_sig: { type: "string", description: "optional bilateral signature" },
        agent_pubkey: { type: "string", description: "optional bilateral public key" },
      },
    },
    read_only: false,
  },
  {
    name: "notary_notarize",
    description:
      "PAID notarization, $0.01 USDC on Base (EIP-3009 via x402; HTTP rail is Base-only — Solana exists only via the remote MCP server). Requires AOTRUST_EVM_PRIVATE_KEY in env. Free-tier body shape; the x402 wrapper takes the 402 challenge, signs, and retries.",
    inputSchema: {
      type: "object",
      properties: {
        work_hash: { type: "string", description: "sha256 hex (64 chars)" },
        content: { type: "string", description: "raw text/code ≤60KB" },
        agent_sig: { type: "string", description: "optional bilateral signature" },
        agent_pubkey: { type: "string", description: "optional bilateral public key" },
      },
    },
    read_only: false,
    env_notes: "AOTRUST_EVM_PRIVATE_KEY required; AOTRUST_BASE_URL optional (default https://api.aotrust.link)",
  },
];

export { INVALID_SHIELD_ID_ERR, USER_AGENT, encodePdrB64 };