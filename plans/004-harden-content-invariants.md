# Plan 004: Reject malformed and fractional Content JSON

> **Executor instructions**: Fix the trust boundary, not each caller. Add the
> regression cases first, preserve permissive legacy migration after the root
> shape is known to be safe, and stop on any compatibility ambiguity.
>
> **Drift check (run first)**:
> `git diff --stat d06eb1f..HEAD -- shared/contentValidation.ts client/src/mapBuilder.test.ts client/package.json server/src/room.test.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-establish-quality-gate.md`
- **Category**: bug
- **Planned at**: commit `d06eb1f`, 2026-07-16

## Why this matters

`validateGameContent` currently normalizes unknown input before proving it has
an object/array shape that normalization can safely read. Inputs such as `null`,
an array, or `{ board: "bad" }` throw instead of returning normal validation
errors; the Vite writer turns that into HTTP 500.

The same validator accepts fractional Coin and movement consequences. The
authoritative server rounds Coins but stores a fractional movement position,
while Map Simulation rounds movement and keeps fractional Coins. Content JSON
defines discrete Coins and Board Cell movement, so the smallest reliable fix is
to reject fractions at the authoring/import boundary.

## Current state

```ts
// shared/contentValidation.ts:390-396
export function validateGameContent(content: unknown): ContentValidationResult {
  const normalized = normalizeContentSchema(content);
  const issues: ContentValidationIssue[] = [];
  // ...
  if (!isRecord(content) || !isRecord(content.events)) error("events", "must be an object");
```

```ts
// shared/contentValidation.ts:455-457
const normalized = normalizeContentSchema(content);
const result = validateGameContent(normalized);
```

```ts
// shared/contentValidation.ts:747-753
if (action.type === "coins" && !Number.isFinite(action.value)) /* error */
if (action.type === "coinTransfer" || action.type === "coinRedistribute") {
  if (!Number.isFinite(action.amount) || action.amount < 0) /* error */
}
if (action.type === "move" && !Number.isFinite(action.delta)) /* error */
```

Observed read-only diagnostics at commit `d06eb1f`:

- `validateGameContent(null)` throws while reading `events`.
- `validateGameContent([])` throws while mapping an absent board.
- `{ events: {}, board: "bad", players: [] }` throws `content.board.map is not a function`.
- A production-content clone containing `coins: 1.5` and `move: 0.5` returns no
  validation errors for those actions.

Domain constraints from `UBIQUITOUS_LANGUAGE.md:102-108`: Consequences change
state immediately; Coin balances never go negative; movement targets Board
Cells. `movementMultiplier` and percentage bias remain legitimately fractional.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Client validation tests | `npm run test -w client` | new malformed/fractional cases pass |
| Server tests | `npm run test -w server` | exit 0 |
| Typechecks | `npm run typecheck` | exit 0 |
| Full gate | `npm run check` | exit 0 |

## Scope

**In scope**:

- `shared/contentValidation.ts`
- `client/src/mapBuilder.test.ts`
- `client/package.json` only if Plan 001's test script needs the new test file
- `server/src/room.test.ts` only for one integer-consequence regression if
  existing validation tests cannot cover the server load boundary

**Out of scope**:

- Replacing the validator with a new schema framework.
- Changing legacy field migration after root shape validation succeeds.
- Supporting fractional Coins or fractional Board Cell positions.
- Changing `movementMultiplier`, `diceBias`, probabilities, camera values, or
  other intentionally continuous numbers.
- Solving the separate Board Cell id-versus-index architecture decision.

## Git workflow

- Branch: `advisor/004-content-invariants`
- Commit: `Harden Essence content validation`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add malformed-root regression cases

In the existing assert-based validation tests, add a table for:

- `null`;
- an array root;
- missing/array `events`;
- non-array `players`;
- non-array `board`;
- non-array `maps`;
- a map whose `board` or `routes` is not an array.

Each call must return `{ ok: false }` with a path-specific error and must not
throw. Add one valid legacy-shaped fixture to prove migration still runs.

**Verify**: tests fail against current code because malformed cases throw.

### Step 2: Gate shape before normalization and normalize once

Inside `shared/contentValidation.ts`, collect minimal root/container shape
issues before calling `normalizeContentSchema`. If the shape is unsafe for
normalization, return the normal `ContentValidationResult` immediately.

After the gate passes, normalize once and pass the normalized value to a private
validation path. Make `assertValidGameContent` reuse that result instead of
normalizing and then calling a function that normalizes again.

Do not reject optional catalogs merely because they are absent. Preserve all
existing migration behavior for valid object/array containers.

**Verify**: malformed-root tests and all existing client tests pass.

### Step 3: Enforce discrete action values

Require integers for:

- `coins.value` (positive or negative);
- `coinTransfer.amount` and `coinRedistribute.amount` (integer and non-negative);
- `move.delta` (positive, zero, or negative integer).

Keep the existing integer requirements for `moveTo.tileId`, skip turns, ranks,
and durations. Do not round silently in validation; return a path-specific
authoring error so builders can show the actual problem.

Add tests for `1.5`, `-1.5`, `NaN` where representable in direct objects, and
valid integer boundaries. Confirm current `shared/content.json` remains valid.

**Verify**: `npm run test -w client` and `npm run test -w server` exit 0.

### Step 4: Remove only validation-local dead parameters exposed by strict checks

If `noUnusedParameters` identifies a now-unused `warning` parameter in the
validation path, remove it and update only direct callers. Do not perform the
broader dead-code cleanup from Plan 005 here.

**Verify**: `npm run typecheck` and `npm run check` exit 0.

## Test plan

- Malformed containers return errors and never throw.
- Valid legacy input still normalizes.
- Fractional Coin delta, transfer amount, redistribution amount, and movement
  delta are rejected at exact paths.
- Integer negative Coin/movement values and non-negative transfer amounts pass.
- Current production Content JSON remains valid.
- Existing client/server suites pass unchanged.

## Done criteria

- [x] `validateGameContent` never throws for JSON-compatible root/container shapes.
- [x] `assertValidGameContent` normalizes once.
- [x] Discrete Coin and movement action values require integers.
- [x] Continuous gameplay/config values remain accepted where intended.
- [x] Current `shared/content.json` validates.
- [x] `npm run check` exits 0.
- [x] Only in-scope files changed.
- [x] `plans/README.md` marks 004 `DONE`.

## STOP conditions

- Existing authored Content JSON contains fractional Coin or movement actions.
- A legacy import intentionally uses fractional discrete actions and the desired
  migration cannot be established from tests/docs.
- Safe shape validation requires rewriting normalization or public result types.
- Fixing the issue begins changing Board Cell id/index semantics.

## Maintenance notes

Validation is the trust boundary for builder imports, disk Save, server content
load, and playtest content. Future discrete action fields should require safe
integers here instead of relying on different runtime rounding policies.
