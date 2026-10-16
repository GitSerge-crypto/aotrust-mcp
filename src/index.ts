/**
 * index.ts — MCP stdio server registration (five tools).
 *
 * Responses follow src/tools.ts: upstream JSON verbatim in structuredContent
 * + content[0]; errors passed through with code + message (no rephrasing).
 * Registration uses ZodRawShape (plain objects) — the @modelcontextprotocol/sdk
 * 1.32 `registerTool` contract (not z.object wrappers).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  contentFromError,
  toolNotaryFree,
  toolNotaryLookup,
  toolNotaryStatus,
  toolNotaryVerify,
  toolNotaryNotarize,
} from "./tools.js";

const RAW_STATUS = { job_id: z.string().min(1).describe("Job id from notarization response") };
const RAW_VERIFY = { pdr_b64: z.string().min(1).describe("PDR bundle in base64") };
const RAW_LOOKUP = { shield_id: z.string().min(1).describe("Shield ID — 8 hex characters") };
const RAW_FREE = {
  work_hash: z.string().optional().describe("sha256 hex (64 chars) — Mode A"),
  content: z.string().optional().describe("raw text/code ≤60KB — Mode B"),
  agent_sig: z.string().optional().describe("optional bilateral signature"),
  agent_pubkey: z.string().optional().describe("optional bilateral public key"),
};
const RAW_NOTARIZE = RAW_FREE;

// Args coercion (exactly-one-of checks live in tools.ts zod schemas).
type FreeArgs = { work_hash?: string; content?: string; agent_sig?: string; agent_pubkey?: string };

function validateFree(raw: unknown, toolName: string): FreeArgs | { errorReply: unknown } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const hasWh = typeof r["work_hash"] === "string" && r["work_hash"] !== "";
  const hasContent = typeof r["content"] === "string" && r["content"] !== "";
  if (hasWh === hasContent) {
    return {
      errorReply: {
        error: "VALIDATION_ERROR",
        message: `${toolName}: exactly one of work_hash or content is required`,
      },
    };
  }
  const out: FreeArgs = {};
  if (hasWh) out["work_hash"] = r["work_hash"] as string;
  if (hasContent) out["content"] = r["content"] as string;
  for (const k of ["agent_sig", "agent_pubkey"] as const) {
    const v = r[k];
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

export async function runServer(): Promise<void> {
  const server = new McpServer(
    { name: "aotrust-mcp", version: VERSION },
    {
      instructions:
        "AOTrust notary: cryptographic proof-of-existence for AI artifacts. " +
        "Start with notary_free (no wallet) or notary_notarize ($0.01 USDC, Base). " +
        "notary_status / notary_verify / notary_lookup are read-only.",
    },
  );

  const okReply = (structured: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: typeof structured === "string" ? structured : JSON.stringify(structured, null, 2),
      },
    ],
    structuredContent: structured as Record<string, unknown>,
    isError: false,
  });

  const errReply = (structured: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: typeof structured === "string" ? structured : JSON.stringify(structured, null, 2),
      },
    ],
    structuredContent: structured as Record<string, unknown>,
    isError: true,
  });

  server.registerTool(
    "notary_status",
    {
      description: TOOL_DESC_STATUS,
      inputSchema: RAW_STATUS,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args: { job_id: string }) => {
      try {
        const out = await toolNotaryStatus(args);
        return okReply(out.structuredContent ?? out.content[0]?.text ?? null);
      } catch (e) {
        return errReply(structuredFromError(e));
      }
    },
  );

  server.registerTool(
    "notary_verify",
    {
      description: TOOL_DESC_VERIFY,
      inputSchema: RAW_VERIFY,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args: { pdr_b64: string }) => {
      try {
        const out = await toolNotaryVerify(args);
        return okReply(out.structuredContent ?? out.content[0]?.text ?? null);
      } catch (e) {
        return errReply(structuredFromError(e));
      }
    },
  );

  server.registerTool(
    "notary_lookup",
    {
      description: TOOL_DESC_LOOKUP,
      inputSchema: RAW_LOOKUP,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args: { shield_id: string }) => {
      try {
        const out = await toolNotaryLookup(args);
        return okReply(out.structuredContent ?? out.content[0]?.text ?? null);
      } catch (e) {
        return errReply(structuredFromError(e));
      }
    },
  );

  server.registerTool(
    "notary_free",
    {
      description: TOOL_DESC_FREE,
      inputSchema: RAW_FREE,
      annotations: { openWorldHint: true },
    },
    async (raw: unknown) => {
      const v = validateFree(raw, "notary_free");
      if ("errorReply" in v) {
        return errReply(v.errorReply);
      }
      try {
        const out = await toolNotaryFree(v);
        return okReply(out.structuredContent ?? out.content[0]?.text ?? null);
      } catch (e) {
        return errReply(structuredFromError(e));
      }
    },
  );

  server.registerTool(
    "notary_notarize",
    {
      description: TOOL_DESC_NOTARIZE,
      inputSchema: RAW_NOTARIZE,
      annotations: { openWorldHint: true },
    },
    async (raw: unknown) => {
      const v = validateFree(raw, "notary_notarize");
      if ("errorReply" in v) {
        return errReply(v.errorReply);
      }
      try {
        const out = await toolNotaryNotarize(v);
        return okReply(out.structuredContent ?? out.content[0]?.text ?? null);
      } catch (e) {
        return errReply(structuredFromError(e));
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the event loop alive while the client holds stdin open. Without a
  // ref-anchored handle the process exits immediately after connect() when
  // spawned programmatically (vitest / child_process) — the stdio transport
  // leaves no other active handle. Closing stdin ends the server naturally.
  const keepAlive = setInterval(() => {}, 60_000);
  process.stdin.on("close", () => {
    clearInterval(keepAlive);
    void server.close().catch(() => {});
    process.exit(0);
  });
}

import {
  ApiError,
} from "./client.js";
import { PaymentConfigError } from "./payment.js";
import { TOOL_SPECS } from "./tools.js";
import { VERSION } from "./env.js";

const TOOL_DESC_STATUS = TOOL_SPECS[0]?.description ?? "Check notarization status by job_id";
const TOOL_DESC_VERIFY = TOOL_SPECS[1]?.description ?? "Server-side PDR verification";
const TOOL_DESC_LOOKUP = TOOL_SPECS[2]?.description ?? "Find record by Shield ID (8 hex)";
const TOOL_DESC_FREE = TOOL_SPECS[3]?.description ?? "Free UNPAID notarization (5/IP/24h)";
const TOOL_DESC_NOTARIZE =
  TOOL_SPECS[4]?.description ??
  "PAID notarization $0.01 USDC on Base; requires AOTRUST_EVM_PRIVATE_KEY";

/** Error → verbatim upstream code+message (never rephrased, never key-revealing). */
function structuredFromError(e: unknown): unknown {
  if (e instanceof PaymentConfigError) {
    return { error: "MISSING_PRIVATE_KEY", message: e.message };
  }
  if (e instanceof ApiError) {
    if (e.body && typeof e.body === "object" && !Array.isArray(e.body)) {
      return e.body;
    }
    return { error: e.code };
  }
  return { error: "LOCAL_ERROR", message: e instanceof Error ? e.message : String(e) };
}