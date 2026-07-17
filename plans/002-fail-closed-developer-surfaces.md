# Plan 002: Make developer surfaces fail closed

> **Executor instructions**: Follow every step and verification gate. Stop on
> a STOP condition instead of weakening the boundary.
>
> **Drift check (run first)**:
> `git diff --stat d06eb1f..HEAD -- package.json client/package.json client/vite.config.ts client/src/featureFlags.ts client/src/App.tsx client/src/components/GameScene3D.tsx client/src/components/EffectBuilder.tsx server/package.json server/src/index.ts shared`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-establish-quality-gate.md`
- **Category**: security
- **Planned at**: commit `d06eb1f`, 2026-07-16

## Why this matters

The documented Railway build/start path does not set `PRODUCTION` or
`NODE_ENV=production`. As a result, builders can remain reachable, the server
debug-effect command is always registered, and playtest is blocked only under
one exact environment combination.

In local development, Vite intentionally listens on the LAN and exposes a
middleware that overwrites the authoritative Content JSON. It trusts the
`Content-Length` header and then buffers the entire body. Developer tools should
be explicitly enabled, and Content JSON writes should be host-local even while
gameplay remains LAN-accessible.

## Current state

```ts
// client/vite.config.ts:15-21
const productionMode = /^(1|true|yes)$/i.test(process.env.PRODUCTION ?? "");
plugins: [...(productionMode ? [] : [localContentSavePlugin()]), react(), tailwindcss()]
```

```ts
// client/vite.config.ts:28-33, 44, 55-57, 77
server: { host: true, fs: { allow: [".."] } }
server.middlewares.use("/api/dev/content", async (req, res) => {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_SAVE_BYTES) { /* reject */ }
  // ...
  await writeFile(CONTENT_FILE_PATH, json, "utf8");
});
```

```ts
// server/src/index.ts:256-260
socket.on("debug:applyEffect", (payload) => withRoom((r) => r.debugApplyEffect(socket.id, payload)));
socket.on("playtest:start", async ({ content: rawContent, mapId }, ack) => {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_PLAYTEST !== "1") {
```

```ts
// client/src/components/EffectBuilder.tsx:358-362
const from = new URLSearchParams(window.location.search).get("from");
return from && from.startsWith("/") ? from : undefined;
```

`README.md:26` requires gameplay access over the LAN. Preserve that. Builder
Save is a local authoring feature; remote authoring is not documented.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Full gate | `npm run check` | exit 0 |
| Server tests | `npm run test -w server` | exit 0 |
| Client tests | `npm run test -w client` | exit 0 |
| Production build | `npm run build` | exit 0; builders/debug UI disabled by default |
| Dev run | `npm run dev` | client/server start with developer tools explicitly enabled |

## Scope

**In scope**:

- `package.json`, `client/package.json`, `server/package.json`
- `client/vite.config.ts`
- `client/src/featureFlags.ts`
- `client/src/App.tsx`
- `client/src/components/GameScene3D.tsx`
- `client/src/components/EffectBuilder.tsx`
- one small shared positive-flag helper and its client test
- one small dev-content-save boundary module and its client test
- `server/src/index.ts`
- `README.md`

**Out of scope**:

- Authentication/accounts for this trusted-party game.
- Disabling LAN gameplay or changing Socket.IO CORS.
- Moving Content JSON to a database.
- Enabling remote builder authoring.
- Changing builder UX or draft semantics.

## Git workflow

- Branch: `advisor/002-dev-surfaces`
- Commit: `Make developer surfaces fail closed`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Replace the negative production flag with one positive flag

Introduce one tiny shared predicate for `ENABLE_DEV_TOOLS` values. It should
return true only for explicit `1`, `true`, or boolean `true`; missing/unknown
values are false.

Set `ENABLE_DEV_TOOLS=1` only in local `dev` scripts. Normal `build`, `start`,
and the documented Railway path must default to false. Define a client
`ESSENCE_DEV_TOOLS` build constant and rename `isProductionMode` usage to a
positive `developerToolsEnabled` check.

Gate all builder routes, Tools Hub links, debug UI, `debug:applyEffect`, and
`playtest:start` on the same positive contract. Return the existing typed error
from denied playtest requests; silently ignore or emit a safe error for denied
debug-effect events.

**Verify**: new flag tests cover missing, false-like, and true-like values;
`npm run test -w client` and `npm run test -w server` exit 0.

### Step 2: Protect the Content JSON write boundary

Keep Vite `host: true` for LAN gameplay. Install the write middleware only when
developer tools are enabled, and accept writes only from loopback addresses
(`127.0.0.1`, `::1`, and IPv4-mapped loopback). Return 403 for a non-loopback
peer before reading the body.

Replace the current unbounded `readBody` with a streaming byte counter that
rejects as soon as UTF-8 bytes exceed `MAX_SAVE_BYTES`, regardless of
`Content-Length`. Retain the early declared-length check as a fast path. Ensure
listeners are cleaned up when the request resolves or rejects.

Use a small Node stream test: loopback accepted, LAN address rejected, body at
limit accepted, body over limit rejected even without `Content-Length`.

**Verify**: the new focused test exits 0 and `npm run typecheck -w client`
exits 0.

### Step 3: Constrain Effect Builder return navigation

`from.startsWith("/")` also accepts network-path references beginning `//`.
Resolve the candidate against `window.location.origin` and return only a
same-origin pathname/search/hash, or allowlist the actual local return routes.
Keep `/tools` as fallback.

Add a pure test for `/tools`, an internal route with query text, `//external`,
an absolute external URL, and malformed input.

**Verify**: focused client test exits 0.

### Step 4: Align documentation and production behavior

Update README so `npm run dev` explicitly enables developer tools and
`npm run build && npm start` defaults them off. Document the opt-in environment
variable only for trusted QA deployments; do not instruct public production to
enable it.

Run a production build and inspect `/tools?debugTools=1`: it must render the
normal game app, not a builder or debug tool. Run local dev from `localhost` and
verify builder Save still writes validated Content JSON. From another LAN
device, gameplay must load but the write endpoint must return 403.

**Verify**: `npm run check` exits 0 plus the manual paths above.

## Test plan

- Positive developer-tools flag matrix.
- Loopback-address matrix, including IPv4-mapped loopback.
- Stream body exactly at and one byte over the limit without relying on headers.
- Same-origin return-route matrix.
- Existing client/server suites.
- Manual local Save, production builder denial, and LAN gameplay checks.

## Done criteria

- [x] Developer/debug surfaces require an explicit positive flag.
- [x] Normal build/start defaults the flag off.
- [x] LAN gameplay remains available.
- [x] Content writes accept loopback only and enforce actual streamed bytes.
- [x] Effect Builder cannot navigate to another origin.
- [x] `npm run check` exits 0.
- [x] Only in-scope files changed.
- [x] `plans/README.md` marks 002 `DONE`.

## Verification note

The live loopback Map Builder Save returned 200, while the same endpoint
returned 403 through the host's LAN address. The Save also exposed pre-existing
Map Builder canonicalization drift that rewrites the current Content JSON; the
test write was restored immediately. That authoring drift is separate from this
access-control plan and remains a follow-up finding.

## STOP conditions

- Remote/LAN builder authoring is an actual product requirement; report before
  replacing it with loopback-only writes.
- A supported deployment intentionally serves builders publicly.
- The positive flag cannot be shared without importing Node-only code into the
  browser bundle.
- Preserving local Save requires weakening the streamed byte limit.

## Maintenance notes

Keep the flag positive and fail-closed. New developer socket commands, routes,
or write endpoints must reuse this boundary. Do not add a second environment
flag for each tool.
