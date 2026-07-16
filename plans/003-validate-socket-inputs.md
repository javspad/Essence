# Plan 003: Validate Socket.IO inputs before dispatch

> **Executor instructions**: Execute test-first. Do not add authentication or
> redesign the socket protocol while implementing this boundary.
>
> **Drift check (run first)**:
> `git diff --stat d06eb1f..HEAD -- shared/types.ts shared/socketSchemas.ts server/src/index.ts server/src/socketInput.ts server/src/socketInput.test.ts server/package.json`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-establish-quality-gate.md`
- **Category**: security/correctness
- **Planned at**: commit `d06eb1f`, 2026-07-16

## Why this matters

`ClientToServerEvents` provides compile-time types only. Socket.IO clients are
untrusted at runtime: `null` payloads, missing acknowledgement callbacks, or
wrong field types can reach destructuring and callback invocation in
`server/src/index.ts` and throw before a `GameRoom` method can reject them. One
uncaught listener exception can terminate the process and every in-memory Room.

The repo already depends on Zod in `shared/`; use it. The goal is a thin trust
boundary, not a new transport framework.

## Current state

```ts
// server/src/index.ts:116
socket.on("room:create", ({ name, roomName, characterId, mapId }, ack) => {
```

```ts
// server/src/index.ts:203-206
socket.on("game:start", (ack) => {
  const code = socketIndex.get(socket.id);
  const room = code ? rooms.get(code) : undefined;
  ack(room ? room.startGame(socket.id) : { ok: false, error: "No estás en una sala" });
});
```

```ts
// shared/types.ts:1134-1199
export interface ClientToServerEvents { /* TypeScript signatures only */ }
```

Room methods already return typed Spanish user-facing errors. Preserve that
style. Do not expose stack traces or raw Zod internals to clients.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `npm run test -w server` | existing room tests and new socket-input tests pass |
| Server typecheck | `npm run typecheck -w server` | exit 0 |
| Full gate | `npm run check` | exit 0 |
| Smoke | `npm run smoke` | existing three-player game completes when server is running |

## Scope

**In scope**:

- `shared/socketSchemas.ts` (create) or an equivalently named single schema file
- `server/src/socketInput.ts` (create)
- `server/src/socketInput.test.ts` (create)
- `server/src/index.ts`
- `server/package.json`
- `scripts/smoke.mjs`, `scripts/qa/cam_bots.mjs`, and
  `client/essence_socket_check.mjs` to align existing QA clients with the
  documented acknowledgement contract
- `shared/types.ts` only if types are inferred from schemas without weakening
  the public event contract

**Out of scope**:

- Authentication, rate limiting, persistence, or CORS changes.
- Validating arbitrary minigame-specific `payload` content.
- Changing successful response shapes.
- Refactoring `GameRoom` methods.
- Adding a second validation dependency.

## Git workflow

- Branch: `advisor/003-socket-inputs`
- Commit: `Validate Socket.IO inputs`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Characterize malformed boundary cases

Create focused tests for the boundary helper before wiring listeners. At
minimum cover:

- `null`, array, and missing payloads;
- non-function/missing acknowledgements;
- non-finite result scores and playtest rolls;
- empty/oversized room names, codes, ids, and reconnect tokens;
- invalid `outcome` values;
- a valid example for every schema.

The helper must never throw for malformed input. It should return a small typed
failure and optionally send a stable generic error through a valid ack.

**Verify**: focused tests fail before implementation for the intended reasons.

### Step 2: Define schemas at the shared contract boundary

Using existing Zod, define schemas for payload-bearing socket events. Reuse
small bounded string/finite-number primitives. Keep opaque activity payloads as
`unknown`; validate only their envelope. Keep limits compatible with current UI
constraints (for example the server already truncates Room names to 40).

Do not define schemas for no-payload signals such as `turn:next`. Do not turn
this into an RPC abstraction.

**Verify**: schema tests pass and `npm run typecheck -w server` exits 0.

### Step 3: Put one guard in front of every payload listener

Add one server helper that parses a payload and checks an ack when the event
requires one. Wire it before destructuring in `room:create`, `room:join`,
economy/shop commands, minigame result, debug effect, and playtest commands.

For malformed input:

- never invoke a missing/non-function ack;
- use a stable generic Spanish error for valid acks;
- do not call a `GameRoom` method;
- do not include raw validation internals in logs or responses.

Keep no-payload listeners unchanged. Preserve all valid client behavior.

**Verify**: `npm run test -w server` and `npm run typecheck -w server` exit 0.

### Step 4: Run the real smoke path

Start the server with its normal command and run `npm run smoke`. Then send the
malformed cases from the focused test harness and verify the server stays alive
and `/health` still returns 200.

**Verify**: smoke completes and health remains available after malformed input.

## Test plan

- Table-driven schema tests for every payload event.
- Boundary helper tests proving malformed values never throw.
- One valid sample per event to prevent over-restricting the current client.
- Existing server room tests.
- Existing multiplayer smoke plus post-malformed `/health` check.

## Done criteria

- [x] Every payload-bearing socket listener parses before destructuring.
- [x] Every ack-requiring listener checks the callback before invoking it.
- [x] Malformed payloads do not reach `GameRoom`.
- [x] Valid event and response shapes are unchanged.
- [x] Server tests, typecheck, smoke, and `npm run check` pass.
- [x] Only in-scope files changed.
- [x] `plans/README.md` marks 003 `DONE`.

## STOP conditions

- An existing valid client emits a payload outside the documented TypeScript
  contract; report the exact event before widening the schema.
- Validation requires inspecting minigame-engine-specific opaque payload data.
- The change starts altering Room authorization or successful response shapes.
- A helper abstraction becomes larger than the listener code it replaces.

## Maintenance notes

New socket events with data must add one schema and one valid/malformed test.
Keep domain rejection inside `GameRoom`; this boundary only proves that the
transport envelope is safe to read.
