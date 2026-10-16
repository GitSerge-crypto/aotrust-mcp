#!/usr/bin/env node
/**
 * cli.ts — stdio bootstrap for aotrust-mcp.
 *
 * Flags:
 *   --tools    print JSON tool-specs and exit 0
 *   --version  print package version and exit 0
 * default: start the MCP stdio server (src/index.ts).
 */
import { createRequire } from "node:module";
import { TOOL_SPECS } from "./tools.js";
import { runServer } from "./index.js";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);

if (args.includes("--version")) {
  const pkg = require("../package.json") as { version: string };
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (args.includes("--tools")) {
  process.stdout.write(`${JSON.stringify({ tools: TOOL_SPECS }, null, 2)}\n`);
  process.exit(0);
}

await runServer();