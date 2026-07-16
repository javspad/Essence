# Plan 005: Remove verified dead TypeScript surface

> **Executor instructions**: Delete only code independently confirmed by both
> graph/search evidence or compiler unused diagnostics. Do not run Fallow's
> broad auto-fix without reviewing its exact dry-run output.
>
> **Drift check (run first)**:
> `git diff --stat d06eb1f..HEAD -- client/tsconfig.json server/tsconfig.json client/src server/src shared/contentValidation.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/004-harden-content-invariants.md`
- **Category**: tech-debt
- **Planned at**: commit `d06eb1f`, 2026-07-16

## Why this matters

Fallow identified three genuinely unreachable UI modules, and TypeScript with
unused checks enabled reports 18 unique dead imports, functions, parameters,
and one server class member. Normal project typechecks omit those compiler
checks, so stale builder fragments can accumulate unnoticed.

This is a deletion-first cleanup followed by compiler enforcement. It does not
bulk-remove exported test/public seams merely to improve Fallow's score.

## Current state

Verified unreachable modules:

- `client/src/components/Board.tsx` is not imported; runtime board rendering
  enters through `ConnectedGame.tsx -> GameScene3D.tsx -> Board3DShell.tsx`.
- `client/src/components/ui/tooltip.tsx` is used only by
  `client/src/components/ui/8bit/tooltip.tsx`; the wrapper itself has no callers.

Read-only compiler command:

```bash
./node_modules/.bin/tsc -p client/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
./node_modules/.bin/tsc -p server/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
```

Current unique diagnostics include:

- unused import: `ArtifactBuilder.tsx` `EventAction`, `MapPlaytest.tsx`
  `useMemo`, `SoundBuilder.tsx` `Volume2`;
- dead builder functions: `EventBuilder.tsx` effect CRUD/panel/value helper,
  `MapBuilder.tsx` `TestPanel` and `ExportPanel`, `CharacterBuilder.tsx`
  `TextInput`;
- dead rendering helper: `board3dAssets.tsx` `MiniPlane`;
- unused callback parameters in three `Board3DShell.tsx` branches;
- dead server member/helper: `room.ts` `effectTargetName` and `valueText`;
- one validation parameter handled by Plan 004.

Two small naming/duplication defects are also verified:

```ts
// client/src/components/ui/8bit/badge.tsx:25
export interface BitButtonProps // this is the Badge prop type
```

```ts
// client/src/mapBuilder.ts:91
export const TILE_TYPES: TileType[] = [ /* copy of shared/types.ts:10 */ ];
```

Both tsconfigs enable `strict` but not `noUnusedLocals` or
`noUnusedParameters`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unused gate | `npm run typecheck` | exit 0 after flags are enabled |
| Client tests | `npm run test -w client` | exit 0 |
| Server tests | `npm run test -w server` | exit 0 |
| Build | `npm run build` | exit 0 |
| Fallow preview | `npm run fallow:full` | inherited findings may remain; deleted files/unused locals are gone |
| Full gate | `npm run check` | exit 0 |

## Scope

**In scope**:

- Delete `client/src/components/Board.tsx`.
- Delete `client/src/components/ui/tooltip.tsx`.
- Delete `client/src/components/ui/8bit/tooltip.tsx`.
- Files named by the current compiler unused diagnostics.
- `client/src/components/ui/8bit/badge.tsx`.
- `client/src/mapBuilder.ts` and its direct `TILE_TYPES` importers.
- `client/tsconfig.json`, `server/tsconfig.json`.

**Out of scope**:

- Removing export modifiers from all 60 Fallow findings.
- Refactoring large components or extracting cosmetic renderers.
- Deleting QA/provenance scripts.
- Replacing the two intentional UI component families.
- Enabling additional TypeScript strictness flags beyond unused locals/params.
- Formatting unrelated code.

## Git workflow

- Branch: `advisor/005-dead-typescript`
- Commit: `Remove dead Essence TypeScript surface`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Reproduce and freeze the unused diagnostic list

Run both compiler commands from Current state and save the file/symbol list in
your working notes. Compare it with the list above. Investigate any new item;
do not delete it automatically.

Use `rg` for every entire-file deletion and verify there are no imports outside
the file pair described above.

**Verify**: current commands fail only with understood unused diagnostics;
`rg` confirms the three modules have no external callers.

### Step 2: Delete unreachable files and declarations

Delete the three dead UI modules. Remove only compiler-reported imports,
functions, members, and unused callback parameter names. For callbacks whose
signature requires positional arguments, omit the unused binding where valid
or prefix it with `_` only if the framework/API requires the slot.

Do not change live behavior adjacent to deleted functions. Do not move code.

**Verify**: rerun both compiler commands with command-line unused flags -> no
unused diagnostics.

### Step 3: Fix the two verified duplicate/naming defects

Rename the Badge prop interface to `BitBadgeProps` and update its local use.
No external importer currently uses the wrong name; confirm with `rg` first.

Remove the client-local `TILE_TYPES` copy and import the canonical constant from
`@essence/shared`. Preserve the inferred `TileType` behavior and rendered option
order.

**Verify**: `npm run test -w client` and `npm run typecheck -w client` exit 0.

### Step 4: Turn unused checks on permanently

Set `noUnusedLocals: true` and `noUnusedParameters: true` in both tsconfigs.
Do not add per-file suppression comments for the current diagnostics.

Run all tests, typechecks, and build. Run Fallow full as an advisory comparison;
do not fail this plan because unrelated inherited export/complexity findings
remain.

**Verify**: `npm run check` exits 0.

## Test plan

- Compiler unused checks are the primary regression check.
- Existing client/server tests prove no live imports were removed.
- Client build proves the Vite graph has no deleted module reference.
- `rg` checks prove the removed files and wrong `BitButtonProps` badge name are
  absent.
- Fallow full no longer reports the three deleted UI files.

## Done criteria

- [x] The three dead UI modules are deleted.
- [x] Both TypeScript projects enable unused locals and parameters.
- [x] Both typechecks emit zero unused diagnostics.
- [x] Badge props are named `BitBadgeProps`.
- [x] Map Builder reuses shared `TILE_TYPES`.
- [x] Tests, build, and `npm run check` pass.
- [x] No QA/provenance file or unrelated export was removed.
- [x] Only in-scope files changed.
- [x] `plans/README.md` marks 005 `DONE`.

## STOP conditions

- Any supposedly dead module is loaded dynamically by a path not visible to
  `rg` or the Vite graph.
- An unused function is referenced by a current roadmap/manual QA flow.
- Enabling compiler flags requires suppressing generated or vendored code.
- Plan 004 did not land and the remaining validation diagnostic conflicts with
  its in-progress changes.

## Maintenance notes

Keep Fallow for graph-level files/exports and TypeScript for local dead
declarations; neither replaces the other. Review future unused-export cleanup
symbol by symbol because this private app still uses exported helpers as test
seams.
