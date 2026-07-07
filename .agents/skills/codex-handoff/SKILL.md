---
name: codex-handoff
description: Prepare a handoff for a fresh Codex session or thread, especially when the user wants the next agent to set a long-running goal and start the next available implementation slice. Use when the user asks to create a Codex handoff, continue work elsewhere, open a new Codex session from a handoff, seed a new agent with context, set a goal from current work, or route a handoff prompt into another coding session.
---

# Codex Handoff

## Overview

Create a compact bridge from the current session to a fresh Codex session. Package the current state, suggested skills, a concrete goal, and the next available slice into a prompt the receiving agent can act on immediately.

## Workflow

1. Determine the target.
   - If the user wants only a handoff document, write one to the OS temp directory.
   - If the user wants a new Codex session/thread, prepare the handoff plus a launch prompt; use Codex thread tools when available and explicitly requested.
   - If the user wants to paste the handoff somewhere else, provide the exact prompt text and the handoff path.
   - Do not set a goal in the current thread unless the user explicitly wants this current thread to become the worker.

2. Build the handoff.
   - Summarize the current objective, decisions, current state, relevant files, commands already run, and known blockers.
   - Reference existing artifacts such as PRDs, plans, issues, commits, diffs, screenshots, and prior handoffs by path or URL instead of duplicating them.
   - Include a "Suggested skills" section with the skills the next agent should load first and why.
   - Redact API keys, secrets, passwords, private personal data, and unnecessary tokens.
   - Prefer precise file paths and concrete next actions over broad narrative.

3. Define the next goal.
   - Write a single goal suitable for a long-running Codex session.
   - Scope it to the next useful outcome, not the whole project unless the user asked for that.
   - Name the first available implementation slice and explain why it is first.
   - Include stop conditions: what counts as complete, what should be verified, and what should be handed back.

4. Produce the launch prompt.
   - Start with an instruction to use the handoff.
   - Ask the receiving agent to create a goal for the session before implementation.
   - Ask it to load suggested skills, inspect the repo, implement the first slice, verify the result, and report back with changed files and remaining work.
   - If a handoff file exists, include its absolute path.

## Output Shape

Use this structure for handoff documents:

```markdown
# Handoff: <short task name>

## Goal for the Next Session
<one concrete goal the receiving Codex session should create>

## Current State
<what has been decided, built, changed, or discovered>

## Relevant Artifacts
- <absolute path or URL>: <why it matters>

## Suggested Skills
- <skill-name>: <why the next agent should use it>

## Next Available Slice
<the first implementable slice, with expected outcome>

## Validation
<commands or manual checks that should prove the slice is done>

## Open Questions or Risks
<only questions that could block or materially change the next slice>
```

Use this structure for the launch prompt:

```text
Use the handoff at <absolute handoff path or pasted handoff below>.

First, create a goal for this Codex session:
<goal>

Then load the suggested skills, inspect the referenced files, and implement the next available slice:
<slice>

Verify the slice, document any UI validation checklist if relevant, and finish with changed files, verification performed, and remaining work.
```

## Session Routing

When the user asks to open, create, continue, or send work to a Codex thread, use the available Codex thread tools for the environment. If the tools are unavailable, provide the exact launch prompt so the user can paste it into a new session.

If the handoff should start a long worker session, make the prompt goal-oriented rather than conversational. The receiving agent should be able to begin without asking what to do next.

## Quality Bar

- Keep the handoff short enough to be read quickly, but concrete enough to remove ambiguity.
- Include the next action, not just background.
- Preserve useful uncertainty: list real risks and unknowns rather than smoothing them away.
- Do not invent completion status, test results, or file changes.
- Prefer absolute paths for local files.
