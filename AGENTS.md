# aotrust-mcp

## Language
- Reports, explanations, and questions: Russian.
- Code, comments, commit messages, identifiers, docs: English.
- Never answer in Chinese, whatever the model default is.

## Boundaries
- Local commit only. `git push` and `npm publish` are the owner's call.
- Change only `package.json`, `package-lock.json`, or `src/` when the task says so.
- After any change: `npm test`, `npm run build`, `npm run smoke` must pass.
- Version bumps: patch only, unless told otherwise.
- Never add dependencies without stating why in the report.
