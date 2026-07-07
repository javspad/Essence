---
name: validation-checklist
description: Create a manual validation checklist for changes that can be verified through the UI, especially after frontend, workflow, routing, state, form, visual, or user-facing behavior changes. Use when the user asks how to validate completed work, wants a checklist of UI items to inspect, asks what to test manually, or needs handoff-ready acceptance checks that are not automated test commands.
---

# Validation Checklist

## Overview

Write a concise checklist the user can follow in the app to confirm that recent changes work and look right. Focus on manual UI validation, even when the underlying change is not purely frontend.

## Workflow

1. Identify what changed.
   - Read the conversation, diffs, referenced files, issue, PRD, or handoff.
   - Group changes by user-visible flow, screen, component, route, or state.
   - If the code is unavailable, infer from the handoff and label assumptions clearly.

2. Convert changes into human checks.
   - Prefer actions the user can perform: navigate, click, type, resize, refresh, submit, cancel, undo, switch tabs, or trigger states.
   - Include what should be visible or true after each action.
   - Cover both "works correctly" and "looks good" checks.
   - Avoid telling the user to run automated tests unless they asked for that too.

3. Cover the important surfaces.
   - Happy path: the main flow the change was designed to support.
   - Edge states: empty, loading, error, disabled, long text, overflow, missing data, and permission-limited states when relevant.
   - Responsive behavior: desktop and mobile sizes for layouts, modals, menus, tables, sidebars, and dense controls.
   - Interaction details: focus, hover, keyboard, selection, scrolling, persistence, and navigation.
   - Visual polish: spacing, alignment, text fit, icon state, truncation, contrast, and absence of overlap.
   - Regression checks: nearby flows that may have been affected by shared components or state.

4. Keep it usable.
   - Write checklist items as checkboxes.
   - Keep each item specific enough that the user knows where to go and what success looks like.
   - Use route names, feature names, or visible labels when known.
   - Put the highest-risk checks first.
   - Mark optional/deeper checks separately only when the list would otherwise become noisy.

## Output Shape

Use this structure by default:

```markdown
## Validation Checklist

### Primary Flow
- [ ] <Go to X, do Y, verify Z.>

### UI States
- [ ] <Verify loading/empty/error/disabled/long-content behavior relevant to the change.>

### Responsive and Polish
- [ ] <Verify desktop/mobile layout, spacing, alignment, text fit, and no overlap.>

### Regression Checks
- [ ] <Verify nearby existing behavior still works.>
```

For small changes, collapse the sections into a single checklist. For large changes, group by route or workflow instead of using generic categories.

## Style

- Use plain user-facing language.
- Include exact UI entry points when known.
- Prefer "Verify..." items that include an expected result.
- Do not bury the checklist inside a long explanation.
- Do not include implementation details unless they explain what the user must validate.
- Do not claim a browser or human check was performed unless it actually was.

## Handoff Use

When included in a handoff, make the checklist self-contained enough for the next person to validate the UI without reading all code changes first. Reference screenshots, local URLs, seeded test data, or accounts only when they are available and safe to share.
