/**
 * tests/server.test.ts — MCP protocol level without network:
 * raw stdio server spawn + tools/list, and a live read-only notary_status
 * call against the ethalon job (the ONLY LIVE PROBE allowed).
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ETHALON_JOB_ID } from "./helpers.js";

const SERVER_ENTRY = new URL("../dist/cli.js", import.meta.url).pathname;

describe("stdio server (protocol level)", () => {
  let client: Client | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.close();
      } catch {
        /* already closed */
      }
      client = null;
    }
  });

  it("tools/list exposes exactly 5 aotrust tools", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY] });
    client = new Client({ name: "vitest", version: "0.0.1" });
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(["notary_status", "notary_verify", "notary_lookup", "notary_free", "notary_notarize"]);
    const paid = tools.tools.find((t) => t.name === "notary_notarize");
    expect(paid?.description).toContain("$0.01");
    expect(paid?.description).toContain("AOTRUST_EVM_PRIVATE_KEY");
  });

  it("notary_lookup with a 7-hex id returns server-form 400 locally (no network)", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY] });
    client = new Client({ name: "vitest", version: "0.0.1" });
    await client.connect(transport);
    const res = await client.callTool({ name: "notary_lookup", arguments: { shield_id: "1234567" } });
    expect(res.isError).toBe(true);
    const sc = (res.structuredContent ?? {}) as Record<string, unknown>;
    expect(sc["error"]).toBe("INVALID_SHIELD_ID");
    expect(sc["message"]).toBe("Shield ID must be 8 hexadecimal characters");
  });

  it("notary_notarize without the key returns MISSING_PRIVATE_KEY, no leak, (no network)", async () => {
    const env = { ...process.env };
    delete env.AOTRUST_EVM_PRIVATE_KEY;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY],
      env,
    });
    client = new Client({ name: "vitest", version: "0.0.1" });
    await client.connect(transport);
    const res = await client.callTool({
      name: "notary_notarize",
      arguments: { work_hash: "9".repeat(64) },
    });
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc["error"]).toBe("MISSING_PRIVATE_KEY");
    expect(JSON.stringify(res)).toContain("AOTRUST_EVM_PRIVATE_KEY");
    expect(JSON.stringify(res)).not.toContain("0x0000000000000000000000000000000000000000");
  });

  it("LIVE read-only probe: notary_status on the ethalon job (seq144)", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY] });
    client = new Client({ name: "vitest", version: "0.0.1" });
    await client.connect(transport);
    const res = await client.callTool({
      name: "notary_status",
      arguments: { job_id: ETHALON_JOB_ID },
    });
    expect(res.isError).toBe(false);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc["status"]).toBe("anchored");
    const result = (sc["result"] ?? {}) as Record<string, unknown>;
    expect(typeof result["pdr_b64"]).toBe("string");
    expect(String(result["pdr_b64"]).length).toBeGreaterThan(0);
  }, 30_000);
});