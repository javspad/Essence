# Plan 001: Establish one trustworthy quality gate

> **Executor instructions**: Follow this plan step by step and run every
> verification command. Stop on any STOP condition; do not improvise. Update
> the plan row in `plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat d06eb1f..HEAD -- .fallowrc.json .gitignore package.json package-lock.json client/package.json .github/workflows/quality.yml`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx/tests
- **Planned at**: commit `d06eb1f`, 2026-07-16

## Why this matters

Essence has passing checks but no single command that runs them. The root
`build` script only builds the client, while the roadmap repeatedly lists five
manual commands. Fallow also needs an accurate entrypoint model before its 97
raw findings can safely drive deletion.

This plan installs the exact audited Fallow version, classifies deliberate
scripts, fixes root QA dependency ownership, and adds one PR gate. It does not
attempt to clear the inherited Fallow backlog.

## Current state

- `package.json:11-26` has `build` but no root `test`, `typecheck`, or `check`.
- `client/package.json:8` has tests but no named typecheck script.
- `.fallowrc.json:4-7` lists only JS/JSX `src/index` and `src/main` patterns,
  although runtime entries are TypeScript.
- `scripts/qa/README.md:3-7` documents standalone QA scripts that Fallow
  currently reports as unused files.
- Root scripts import `playwright` and `socket.io-client`; those packages are
  declared only by the client workspace.
- `.github/` does not exist.
- Fallow 3.6.0 reported no cycles and `fallow audit` passed the current diff.

Relevant current excerpts:

```jsonc
// .fallowrc.json:4-7
"entry": [
  "src/index.{js,jsx,mjs}",
  "src/main.{js,jsx,mjs}"
]
```

```jsonc
// package.json:15-21
"build": "npm run build -w client",
"start": "npm run start -w server",
"smoke:lan": "node scripts/lan-multiplayer-smoke.mjs",
"smoke": "tsx scripts/smoke.mjs"
```

Preserve the repo convention of short imperative commit messages, e.g.
`Refactor Essence content and gameplay systems`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install/update lock | `npm install` | exit 0 |
| Client tests | `npm run test -w client` | exit 0; `map simulation tests passed` |
| Server tests | `npm run test -w server` | exit 0 |
| Typechecks | `npm run typecheck` | exit 0 |
| Full local gate | `npm run check` | exit 0 |
| Fallow discovery | `npm run fallow:list` | deliberate runtime and script entrypoints listed |
| Fallow gate | `npm run fallow:audit` | pass, warn, or only newly introduced actionable findings |

## Scope

**In scope**:

- `.fallowrc.json`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `client/package.json`
- `.github/workflows/quality.yml` (create)

**Out of scope**:

- Deleting source or QA files.
- Enabling every advisory Fallow rule.
- Saving a baseline that hides future findings.
- Adding ESLint, Prettier, Husky, or another dependency.
- Fixing inherited complexity or duplication findings.

## Git workflow

- Branch: `advisor/001-quality-gate`
- Commit: `Establish Essence quality gate`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Correct package ownership and scripts

Add exact `fallow` version `3.6.0` to root dev dependencies. Move Playwright
development ownership from `client/package.json` to root because the executable
browser QA scripts live at root; keep `socket.io-client` in client dependencies
and also declare it as a root dependency because Fallow classifies explicit
manual script entrypoints as runtime roots.

Add client script:

```json
"typecheck": "tsc -p tsconfig.json --noEmit"
```

Add root scripts with no wrapper program:

```json
"test": "npm run test -w client && npm run test -w server",
"typecheck": "npm run typecheck -w client && npm run typecheck -w server",
"fallow:full": "fallow",
"fallow:audit": "fallow audit",
"fallow:list": "fallow list",
"check": "npm run test && npm run typecheck && npm run build && npm run fallow:audit"
```

Run `npm install` to update the lockfile. Do not hand-edit lockfile internals.

**Verify**: `npm ls fallow playwright socket.io-client` -> all three resolve;
Fallow resolves exactly `3.6.0`.

### Step 2: Make Fallow's model truthful

Preserve the current workspace patterns and duplication threshold. Expand
entry globs to TypeScript and deliberate standalone script roots:

- workspace runtime entries: `src/index` and `src/main` with TS/TSX/JS forms;
- `scripts/**/*.mjs`;
- `client/essence_*.mjs`;
- `docs/story-source-material/*.mjs`.

Ignore only generated `docs/story-source-material/viewer-data.js`. Add
`@shared/content.json` to `ignoreDependencies` because it is the configured
Vite/TypeScript alias, not an npm package. Do not suppress Playwright or
Socket.IO; Step 1 fixes their ownership.

**Verify**: `npm run fallow:list` -> `client/src/main.tsx`,
`server/src/index.ts`, the documented QA scripts, and story-source scripts are
entrypoints or reachable; no workspace diagnostics.

### Step 3: Add the PR quality workflow

Create `.github/workflows/quality.yml` for `pull_request` only. Use
`actions/checkout@v4` with `fetch-depth: 0`, `actions/setup-node@v4` with a
supported Node 22 runtime and npm cache, then `npm ci` and `npm run check`.
Do not add deployment, secrets, browser QA, or write permissions.

**Verify**: inspect the workflow and run `npm run check` locally -> exit 0.

## Test plan

- Existing client and server tests are the characterization baseline.
- `npm run typecheck` must cover both workspaces.
- `npm run fallow:list` proves the entrypoint model.
- `npm run fallow:audit` proves inherited findings do not block adoption.
- `npm run check` is the single done gate.

## Done criteria

- [x] Fallow 3.6.0 is a root dev dependency and lockfile entry.
- [x] Root QA dependencies are declared at the root point of use.
- [x] `npm run check` exits 0.
- [x] `npm run fallow:list` includes deliberate script entrypoints.
- [x] The PR workflow has no write permissions or secrets.
- [x] Only in-scope files changed.
- [x] `plans/README.md` marks 001 `DONE`.

## STOP conditions

- Fallow 3.6.0 cannot be installed from the existing npm registry.
- Correct entry globs still cause Fallow to omit `client/src/main.tsx` or
  `server/src/index.ts`.
- A root dependency move breaks a documented QA command.
- The current user-owned `.fallowrc.json` or `.gitignore` has drifted from the
  excerpts and the intent cannot be preserved.

## Maintenance notes

Use `fallow audit` as the blocking PR gate because it attributes only newly
introduced findings. Keep `fallow:full` advisory until plans 002-005 reduce the
legacy backlog. Do not lower thresholds merely to improve the score.

Fallow 3.6.0 reports a root `socket.io-client` dev declaration as
`dev-dependency-in-production` because the configured smoke/QA files are manual
entrypoints. Keeping the root declaration in `dependencies` avoids suppressing
the rule and keeps the blocking audit truthful.
