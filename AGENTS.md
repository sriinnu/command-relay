# Agent Instructions

These rules are mandatory for all code changes in this project.

# How codex must perform
- spawn agents as needed
- use chitragupta mcp - as a good agentic assistant.
- use worktress outside of the repo workspace - multiple worktrees for agents. (distilled code instead of full copy of the codebase - as long as you know what to do and how to do, you can have a copy of the the agents.md or claude.md)
- always use Chitragupta as a co-orchestrator agent, run periodic stress/health checks on his agentic capabilities, and report any failures or regressions immediately.
- branch workflow: before creating a new branch, push current work via PR, merge to `main`, then create the next branch from latest `origin/main`.

## Engineering Guardrails

1. No source file may exceed `450` lines of code.
2. Add JSDoc to all exported functions, classes, React components, and hooks.
3. Add inline comments where logic is non-obvious; avoid redundant comments.
4. UI/UX quality must be spot on:
   - clear information hierarchy and spacing
   - responsive behavior on desktop and mobile
   - accessible semantics, focus states, and keyboard usability
   - consistent visual language across screens
5. Typescript - strict typing where possible.
