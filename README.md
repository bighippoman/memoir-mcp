# memoir-mcp

Structured session journals for AI agents. Persistent memory across sessions -- no more repeating dead ends.

When a session ends, all reasoning is lost -- what was tried, what failed, what's blocked. The next session starts from scratch and repeats the same mistakes. memoir logs it all and hands it off so the next session picks up where the last one left off.

Works with any MCP client: Claude Code, Cursor, Codex, Windsurf, and more.

## Install

### Claude Code

```bash
claude mcp add memoir -s user -- npx -y memoir-mcp
```

### Other MCP clients

```bash
npx -y memoir-mcp
```

## How it works

- **Automatic project detection** -- identifies the project by its git root, so logs stay scoped without any configuration.
- **Implicit sessions** -- a session is created automatically on first log. No setup step.
- **Rolling retention** -- keeps the last 20 sessions per project (configurable). Old sessions are pruned automatically.

## Tools

### Write

| Tool | Description |
|------|-------------|
| `log_attempt` | Record something that was tried and its outcome. |
| `log_blocker` | Flag something that's stuck and why. |
| `resolve_blocker` | Mark a blocker as resolved with what fixed it. |
| `log_decision` | Record a design or architecture choice and its rationale. |
| `end_session` | Close the current session with an optional summary. |

### Read

| Tool | Description |
|------|-------------|
| `get_handoff` | Structured summary of the last session -- what was attempted, what's blocked, what was decided. |
| `get_history` | Query past sessions (default: last 3, max 20). |
| `get_blockers` | List unresolved (or resolved) blockers across all sessions. |

## Storage

Single SQLite file at `~/.memoir/memoir.db`. No API keys, no external services.

## Token control

Content is capped at 500 characters, outcomes at 300 characters. Each session holds a maximum of 50 entries. Handoff output uses a compact format to keep context window usage low.

## License

MIT
