/**
 * env.ts — env-var names and defaults (single source of truth).
 *
 * AOTRUST_EVM_PRIVATE_KEY is NEVER read into a string here or printed
 * anywhere; the x402 wrapper consumes it through its own signer.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Package version from ../package.json (path anchored to this module, not cwd). */
export const VERSION: string = pkg.version;

export const DEFAULT_BASE_URL = "https://api.aotrust.link";
export const AOTRUST_BASE_URL_ENV = "AOTRUST_BASE_URL";
export const AOTRUST_EVM_PRIVATE_KEY_ENV = "AOTRUST_EVM_PRIVATE_KEY";
export const USER_AGENT = `aotrust-mcp/${VERSION} (+https://aotrust.link)`;

/** Server-form error for an invalid shield_id (verbatim, load-bearing). */
export const INVALID_SHIELD_ID_ERR = "INVALID_SHIELD_ID";
export const INVALID_SHIELD_ID_MSG = "Shield ID must be 8 hexadecimal characters";