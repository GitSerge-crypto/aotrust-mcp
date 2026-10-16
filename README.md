# aotrust-mcp

<!-- mcp-name: aotrust-mcp -->

Local stdio MCP server for **AOTrust** notarization: cryptographic
proof-of-existence for AI artifacts, wired into any MCP-capable agent
(Claude Code, Codex, and friends) with a one-line config.

Five tools over the AOTrust HTTP API (`https://api.aotrust.link`):

| Tool | Cost | What it does |
|---|---|---|
| `notary_status` | free | job_id → `{status, result{pdr_b64, payment_hash, near_anchor_tx,...}}` (upstream JSON verbatim) |
| `notary_verify` | free | full server-side PDR verification by base64 bundle |
| `notary_lookup` | free | 8-hex Shield ID → record (server-form 400 guard locally for bad shape) |
| `notary_free` | free | UNPAID notarization, no wallet, 5/IP/24h — pass `work_hash` OR `content` (≤60KB) |
| `notary_notarize` | **$0.01 USDC per receipt** | PAID via x402 (challenge → EIP-3009 sign → retry); **requires `AOTRUST_EVM_PRIVATE_KEY`** |

All tool replies pass the upstream JSON through **verbatim** — no invented
fields, error codes unmodified (`FREE_TIER_LIMIT_REACHED` on free tier is
quota, not a defect).

## Install & run

```bash
npm install -g aotrust-mcp   # or: npx aotrust-mcp
aotrust-mcp                  # starts the stdio MCP server
aotrust-mcp --tools          # print tool-spec JSON and exit
aotrust-mcp --version        # 0.1.2
```

## Claude Code config

```json
{
  "mcpServers": {
    "aotrust": {
      "command": "npx",
      "args": ["-y", "aotrust-mcp"],
      "env": {
        "AOTRUST_EVM_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Free tools work with no env at all; only `notary_notarize` needs the key.

## Environment variables

| Var | Required | Meaning |
|---|---|---|
| `AOTRUST_EVM_PRIVATE_KEY` | only for `notary_notarize` | EVM wallet private key (0x-prefixed). Consumed by the x402 EIP-3009 signer. **Never logged or shipped in errors.** |
| `AOTRUST_BASE_URL` | optional | API base, default `https://api.aotrust.link` (no `/v1` suffix — the client appends paths) |

## Paid path notes (v0.1)

- **Base-only.** The HTTP `/notarize` rail settles EIP-3009 USDC on Base
  (`eip155:8453`). Solana payments exist only on the remote MCP server
  (`link.aotrust/notary` in the registry) and are out of scope for this
  stdio wrapper in v0.1 — point Solana-capable agents at the remote server.
- challenge/sign/retry is done by `@x402/fetch` (challenge from the server's
  402 response, EIP-3009 signature, retry with the `x-payment` header).
  No facilitator client-side.
- `AOTRUST_EVM_PRIVATE_KEY` never appears in logs, error messages, or
  tool output. A missing key yields a plain
  `MISSING_PRIVATE_KEY / set AOTRUST_EVM_PRIVATE_KEY ...` reply before any
  network call.

## Limits

- Free tier: **5 notarizations per IP per 24h** (1000/day global). 429 →
  wait, or switch to the paid rail.
- Paid: flat **$0.01** per receipt, no subscription.
- Verification: free forever, offline-capable via the 239-byte PDR format.

## Verification of proofs

PDRs are Ed25519-signed 239-byte bundles anchored daily in Merkle trees on
NEAR mainnet. Verify any receipt at <https://verify.aotrust.link>, or with
`notary_verify` / `notary_lookup` from this server.

## Docs

- AOTrust docs: <https://docs.aotrust.link>
- Python SDK: <https://pypi.org/project/aotrust-protocol/>
- x402: <https://x402.org>

## License

MIT

---

## aotrust-mcp (кратко, RU)

Локальный stdio MCP-сервер нотариата AOTrust — 5 инструментов поверх HTTP API:
`notary_status`, `notary_verify`, `notary_lookup` (бесплатные, read-only),
`notary_free` (бесплатный PDR, лимит 5/IP/24h) и `notary_notarize`
(**$0.01 USDC за PDR**, платный; требует `AOTRUST_EVM_PRIVATE_KEY`).
Ключ расходуется только на EIP-3009-подпись через x402 и никогда не попадает
в логи/ошибки. Платная рельса v0.1 — **только Base**; Solana доступна через
удалённый MCP-сервер из registry (`link.aotrust/notary`). Конфиг Claude Code —
одна строка (`npx aotrust-mcp`) + env-ключ. Ответы тулов — upstream JSON
без изменений; коды ошибок (`FREE_TIER_LIMIT_REACHED` и др.) пробрасываются
как есть.