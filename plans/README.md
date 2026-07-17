# Essence code-quality proposal

Generated from a Fallow 3.6.0 audit on 2026-07-16 at commit `d06eb1f`.
Execute in order unless the dependency column says otherwise. Every executor
must read its plan fully, honor the STOP conditions, and update its row.

## Audit baseline

- Fallow health: **79.1 / B** across 134 files and 4,712 functions.
- Full scan: 97 dead-code/dependency/export findings, 11 clone groups, 6.1%
  duplicated lines, no circular dependencies, and no unused runtime dependency.
- Changed-file audit: **pass** for the current `.fallowrc.json` and `.gitignore`
  work.
- Verification run: client tests, server tests, client typecheck, and server
  typecheck all pass.
- Production dependency audit: zero known vulnerabilities.

Fallow's raw issue count is not the work list. Manual QA/provenance scripts are
entrypoints, duplicate UI export names are mostly intentional, and large files
are not automatically refactor targets. The plans below contain only findings
verified against the source.

## Execution order and status

| Plan | Title | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| [001](001-establish-quality-gate.md) | Establish one trustworthy quality gate | P1 | M | - | DONE |
| [002](002-fail-closed-developer-surfaces.md) | Make developer surfaces fail closed | P1 | M | 001 | DONE |
| [003](003-validate-socket-inputs.md) | Validate Socket.IO inputs before dispatch | P1 | M | 001 | DONE |
| [004](004-harden-content-invariants.md) | Reject malformed and fractional Content JSON | P1 | M | 001 | DONE |
| [005](005-remove-dead-typescript-surface.md) | Remove verified dead TypeScript surface | P2 | M | 004 | DONE |

Status values: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED: <reason>`, or
`REJECTED: <reason>`.

## Dependency notes

- 001 comes first because it creates the single local/CI verification command
  used by every later plan and makes Fallow's entrypoint model trustworthy.
- 002, 003, and 004 can run independently after 001.
- 005 follows 004 because both touch `shared/contentValidation.ts`; sequencing
  avoids a needless merge conflict while enabling compiler unused checks last.

## Vetted findings

| # | Finding | Category | Impact | Effort | Fix risk | Confidence | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | No root quality gate and inaccurate Fallow entrypoints | DX/tests | Checks are easy to skip; raw Fallow output mixes executable scripts with dead code | M | Low | High | `package.json:11`, `.fallowrc.json:4`, `ROADMAP.md:100` |
| 2 | Developer surfaces default open under documented deployment commands | Security | Public builds can expose builders, playtests, and debug effects | M | Medium | High | `package.json:15`, `README.md:71`, `client/src/App.tsx:21`, `server/src/index.ts:256` |
| 3 | LAN Vite server exposes an unauthenticated content writer | Security/data integrity | A reachable client can replace `shared/content.json`; chunked bodies bypass the declared-size check | S | Medium | High | `client/vite.config.ts:28`, `client/vite.config.ts:40`, `client/vite.config.ts:55`, `client/vite.config.ts:77` |
| 4 | Socket payloads are TypeScript-only contracts | Security/correctness | Malformed unauthenticated events can throw before room methods run | M | Medium | High | `server/src/index.ts:116`, `server/src/index.ts:203`, `server/src/index.ts:213` |
| 5 | Validation normalizes before checking root shape | Bug | Valid JSON with the wrong shape throws and becomes a 500 instead of validation errors | M | Medium | High | `shared/contentValidation.ts:390`, `shared/contentValidation.ts:455` |
| 6 | Fractional coin/movement actions are accepted | Bug | Server and simulator apply different rounding; server positions can become fractional | M | Medium | High | `shared/contentValidation.ts:747`, `server/src/economy.ts:120`, `client/src/mapSimulation.ts:826`, `server/src/room.ts:1429` |
| 7 | Three UI modules and 18 TypeScript declarations are dead | Tech debt | Stale builder/board paths remain available for accidental reuse | M | Low | High | `client/src/components/Board.tsx:43`, both tooltip modules, compiler unused diagnostics |

## Direction finding: settle Board Cell identity before graph movement

`Player.position` currently behaves as a board-array index during normal play,
while Map Builder and playtest APIs describe it as a Board Cell id. Validation
allows unique non-contiguous ids, and deleting a cell does not renumber the
remaining board. Current authored maps are contiguous, so this is not included
in the immediate plans. Before shipping branches or route-driven movement,
choose one model: either enforce `tile.id === board index` everywhere, or make
runtime movement resolve Board Cell ids through authored Routes. Do not attempt
both in a cleanup PR.

## Findings considered and rejected

- Split `Board3DShell.tsx`, `EventBuilder.tsx`, or `room.ts` because they are
  large: rejected. File size alone is not a behavior boundary; characterize a
  concrete change first.
- Optimize the 1.11 MB minified (275 kB gzip) `Board3DShell` production chunk
  immediately: deferred. It is already route/phase lazy-loaded; measure board
  load on the actual party hardware before trading maintainability for manual
  chunk configuration.
- Extract all 11 clone groups: rejected. The seven-way save/download clone is
  mostly thin orchestration over the existing `saveContentJsonToDisk` helper,
  and the remaining statuses intentionally differ.
- Delete every Fallow `unused-file`: rejected. QA scripts are documented manual
  entrypoints and story-source scripts are reproducible provenance tools.
- Treat `@shared/content.json` as an npm dependency: rejected. It is a Vite and
  TypeScript alias; configure Fallow accordingly.
- Treat dynamic browser audio fetches or operator-selected smoke-test URLs as
  SSRF: rejected. They do not execute on a privileged server boundary.
- Treat `sendFile(resolve(clientDist, "index.html"))` or the API-key status log
  as security bugs: rejected. Both values are constant/non-secret.
- Canonicalize `.agents`, `.claude`, and `.pi` skill mirrors in this pass:
  rejected. Their duplication may be required by tool discovery and is outside
  application quality scope.
- Bulk-remove all 60 Fallow unused exports: rejected. Removing `export` alone
  has negligible runtime value and several are deliberate test/public seams.
