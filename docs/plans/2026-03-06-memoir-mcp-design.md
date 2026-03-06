# memoir-mcp Design

## Overview

TypeScript MCP server that gives AI agents structured session journals with automatic project detection and cross-session handoff. Solves the "agent amnesia" problem — when a session ends or context compresses, the reasoning and history is lost.

## Problem

When an AI agent session ends, the agent loses:
- What approaches were already tried and why they failed
- What's currently blocked and why
- What design decisions were made and their rationale

CLAUDE.md captures conventions. Git captures code changes. Neither captures the *process* — the dead ends, the blockers, the reasoning.

## Solution

A lightweight MCP server that agents write to during sessions and read from at the start of new sessions. Structured entries, automatic project detection, compact handoff format.

## Storage

- SQLite via `better-sqlite3`
- Single file at `~/.memoir/memoir.db`
- Auto-created on first use
- Recreated with warning if corrupted

## Project Detection

- Resolves nearest `.git` root from working directory
- Each project gets independent sessions
- Falls back to `_default` bucket if no git root found
- If agent works across repos, each repo gets its own parallel session

## Data Model

### sessions
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Auto-increment primary key |
| project_path | TEXT | Git root path |
| started_at | TEXT | ISO timestamp, auto-set on first entry |
| ended_at | TEXT | Nullable, set on close or next session start |
| summary | TEXT | Nullable, agent-generated on close |

### entries
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Auto-increment primary key |
| session_id | INTEGER | Foreign key to sessions |
| type | TEXT | `attempt`, `blocker`, or `decision` |
| content | TEXT | Max 500 chars. What was tried/blocked/decided |
| outcome | TEXT | Nullable, max 300 chars. Result or resolution |
| resolved | INTEGER | Boolean, default 0. For blockers |
| created_at | TEXT | ISO timestamp |

### config
| Column | Type | Notes |
|--------|------|-------|
| key | TEXT | Setting name |
| value | TEXT | Setting value |

Default config: `max_sessions_per_project` = 20.

## Session Lifecycle

- **Implicit creation** — first log entry auto-creates a session if none is open for the project
- **Implicit close** — starting a new session closes the previous one
- **Explicit close** — agent calls `end_session` with optional summary
- **Empty discard** — sessions with zero entries are silently discarded
- **Rolling pruning** — when session count exceeds `max_sessions_per_project`, oldest session and its entries are deleted

## Tools

### Write Tools

**`log_attempt`** — Record something that was tried.
- `content` (string, required, max 500 chars) — what was attempted
- `outcome` (string, optional, max 300 chars) — what happened

**`log_blocker`** — Flag something that's stuck.
- `content` (string, required, max 500 chars) — what's blocked and why

**`resolve_blocker`** — Mark a blocker as resolved.
- `blocker_id` (number, required) — ID of the blocker entry
- `resolution` (string, required, max 300 chars) — what fixed it

**`log_decision`** — Record a design or architecture choice.
- `content` (string, required, max 500 chars) — what was decided and why

**`end_session`** — Explicitly close the current session.
- `summary` (string, optional, max 500 chars) — high-level summary

### Read Tools

**`get_handoff`** — Get a structured summary of the last session for this project. No params. Returns compact one-liners per entry:
```
Last session (2h ago, 12 entries):
- Attempted: migrating auth to Clerk → succeeded
- Attempted: upgrading to Next 16 → failed, peer dep conflicts
- Blocker (unresolved): convex SDK doesn't support React 19 RC
- Decision: keeping Next 15 until convex ships update
```

**`get_history`** — Query past sessions.
- `sessions_back` (number, optional, default 3) — how many sessions to return

**`get_blockers`** — List blockers across sessions.
- `resolved` (boolean, optional, default false) — filter by resolution status

## Token Control

- Content fields: 500 char max
- Outcome/resolution fields: 300 char max
- Max 50 entries per session
- `get_handoff` returns compact one-liner format, not raw entry dumps
- Rolling window prunes old sessions automatically

## Error Handling

- **No git root** — uses `_default` project bucket
- **Database missing** — auto-created
- **Database corrupt** — recreated with warning
- **Empty sessions** — silently discarded
- **Char limit exceeded** — truncated with warning

## Tech Stack

- TypeScript (ESM)
- `@modelcontextprotocol/sdk`
- `better-sqlite3`
- Published to npm as `memoir-mcp`

## Connection Nudge

On MCP connection, if there are unresolved blockers or recent sessions for the detected project, the server surfaces a brief nudge in tool descriptions: "3 unresolved items from your last session — use get_handoff to review."
