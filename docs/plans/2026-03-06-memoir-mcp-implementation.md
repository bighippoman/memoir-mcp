# memoir-mcp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that gives AI agents structured session journals with automatic project detection and cross-session handoff.

**Architecture:** TypeScript MCP server using `better-sqlite3` for storage. Single database at `~/.memoir/memoir.db`. Projects detected from git root. Sessions auto-managed with rolling pruning. 8 tools: 5 write, 3 read.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `vitest`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `src/index.ts` (empty entry point with shebang)

**Step 1: Create package.json**

```json
{
  "name": "memoir-mcp",
  "version": "1.0.0",
  "description": "MCP server for structured session journals — gives AI agents persistent memory across sessions",
  "type": "module",
  "main": "build/index.js",
  "bin": {
    "memoir-mcp": "build/index.js"
  },
  "files": [
    "build",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node build/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "mcp",
    "session",
    "memory",
    "agent",
    "handoff",
    "claude"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/bighippoman/memoir-mcp.git"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "better-sqlite3": "^11.0.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^25.3.3",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Step 3: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/__tests__"]
}
```

**Step 4: Create minimal entry point**

Create `src/index.ts`:
```typescript
#!/usr/bin/env node
// memoir-mcp entry point
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: node_modules created, package-lock.json generated

**Step 6: Verify build**

Run: `npm run build`
Expected: `build/index.js` created with no errors

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json src/index.ts
git commit -m "scaffold project with dependencies"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db.ts`
- Create: `src/__tests__/db.test.ts`

This module handles all SQLite operations: init, schema creation, and CRUD for sessions/entries/config.

**Step 1: Write the failing tests**

Create `src/__tests__/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoirDB } from "../db.js";
import fs from "fs";
import path from "path";
import os from "os";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `memoir-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("MemoirDB", () => {
  let dbPath: string;
  let db: MemoirDB;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoirDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  describe("initialization", () => {
    it("creates database file and tables", () => {
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it("sets default config", () => {
      expect(db.getConfig("max_sessions_per_project")).toBe("20");
    });
  });

  describe("sessions", () => {
    it("creates a session for a project", () => {
      const id = db.createSession("/test/project");
      expect(id).toBeGreaterThan(0);
    });

    it("gets open session for a project", () => {
      const id = db.createSession("/test/project");
      const session = db.getOpenSession("/test/project");
      expect(session).not.toBeNull();
      expect(session!.id).toBe(id);
    });

    it("returns null when no open session exists", () => {
      const session = db.getOpenSession("/test/project");
      expect(session).toBeNull();
    });

    it("closes a session", () => {
      const id = db.createSession("/test/project");
      db.closeSession(id, "done for now");
      const session = db.getOpenSession("/test/project");
      expect(session).toBeNull();
    });

    it("prunes oldest sessions beyond limit", () => {
      db.setConfig("max_sessions_per_project", "2");
      const id1 = db.createSession("/test/project");
      db.closeSession(id1);
      const id2 = db.createSession("/test/project");
      db.closeSession(id2);
      const id3 = db.createSession("/test/project");

      const sessions = db.getRecentSessions("/test/project", 10);
      expect(sessions.length).toBe(2);
      expect(sessions.find(s => s.id === id1)).toBeUndefined();
    });
  });

  describe("entries", () => {
    it("adds an entry to a session", () => {
      const sessionId = db.createSession("/test/project");
      const entryId = db.addEntry(sessionId, "attempt", "tried X", "it worked");
      expect(entryId).toBeGreaterThan(0);
    });

    it("gets entries for a session", () => {
      const sessionId = db.createSession("/test/project");
      db.addEntry(sessionId, "attempt", "tried X", "it worked");
      db.addEntry(sessionId, "blocker", "stuck on Y");
      const entries = db.getEntries(sessionId);
      expect(entries.length).toBe(2);
      expect(entries[0].type).toBe("attempt");
      expect(entries[1].type).toBe("blocker");
    });

    it("enforces max entries per session", () => {
      const sessionId = db.createSession("/test/project");
      for (let i = 0; i < 50; i++) {
        db.addEntry(sessionId, "attempt", `attempt ${i}`);
      }
      expect(() => db.addEntry(sessionId, "attempt", "one too many")).toThrow(/limit/i);
    });

    it("truncates content exceeding char limit", () => {
      const sessionId = db.createSession("/test/project");
      const longContent = "x".repeat(600);
      const entryId = db.addEntry(sessionId, "attempt", longContent);
      const entries = db.getEntries(sessionId);
      expect(entries[0].content.length).toBe(500);
    });

    it("truncates outcome exceeding char limit", () => {
      const sessionId = db.createSession("/test/project");
      const longOutcome = "x".repeat(400);
      const entryId = db.addEntry(sessionId, "attempt", "content", longOutcome);
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome!.length).toBe(300);
    });

    it("resolves a blocker", () => {
      const sessionId = db.createSession("/test/project");
      const entryId = db.addEntry(sessionId, "blocker", "stuck on Y");
      db.resolveBlocker(entryId, "found workaround");
      const entries = db.getEntries(sessionId);
      expect(entries[0].resolved).toBe(1);
      expect(entries[0].outcome).toBe("found workaround");
    });

    it("counts entries in a session", () => {
      const sessionId = db.createSession("/test/project");
      db.addEntry(sessionId, "attempt", "tried X");
      db.addEntry(sessionId, "decision", "chose Y");
      expect(db.getEntryCount(sessionId)).toBe(2);
    });
  });

  describe("blockers", () => {
    it("gets unresolved blockers across sessions", () => {
      const s1 = db.createSession("/test/project");
      db.addEntry(s1, "blocker", "blocker A");
      db.addEntry(s1, "blocker", "blocker B");
      db.closeSession(s1);

      const s2 = db.createSession("/test/project");
      const blockerId = db.addEntry(s2, "blocker", "blocker C");
      db.resolveBlocker(blockerId, "fixed C");

      const blockers = db.getBlockers("/test/project", false);
      expect(blockers.length).toBe(2);
      expect(blockers.every(b => b.resolved === 0)).toBe(true);
    });

    it("gets resolved blockers", () => {
      const s1 = db.createSession("/test/project");
      const id = db.addEntry(s1, "blocker", "blocker A");
      db.resolveBlocker(id, "fixed");

      const resolved = db.getBlockers("/test/project", true);
      expect(resolved.length).toBe(1);
      expect(resolved[0].resolved).toBe(1);
    });
  });

  describe("recent sessions with entries", () => {
    it("returns sessions with their entries", () => {
      const s1 = db.createSession("/test/project");
      db.addEntry(s1, "attempt", "tried X", "worked");
      db.addEntry(s1, "decision", "chose Y");
      db.closeSession(s1, "session 1 done");

      const sessions = db.getRecentSessions("/test/project", 3);
      expect(sessions.length).toBe(1);
      expect(sessions[0].summary).toBe("session 1 done");
    });
  });

  describe("discards empty sessions", () => {
    it("removes session with no entries when a new one starts", () => {
      const s1 = db.createSession("/test/project");
      db.closeSession(s1);
      db.discardIfEmpty(s1);

      const sessions = db.getRecentSessions("/test/project", 10);
      expect(sessions.length).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/db.test.ts`
Expected: FAIL — `MemoirDB` doesn't exist

**Step 3: Implement the database layer**

Create `src/db.ts`:

```typescript
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const MAX_CONTENT_LENGTH = 500;
const MAX_OUTCOME_LENGTH = 300;
const MAX_ENTRIES_PER_SESSION = 50;

export interface Session {
  id: number;
  project_path: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

export interface Entry {
  id: number;
  session_id: number;
  type: string;
  content: string;
  outcome: string | null;
  resolved: number;
  created_at: string;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) : str;
}

export class MemoirDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      this.db = new Database(dbPath);
    } catch {
      try { fs.unlinkSync(dbPath); } catch {}
      this.db = new Database(dbPath);
    }

    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('attempt', 'blocker', 'decision')),
        content TEXT NOT NULL,
        outcome TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
    `);

    const existing = this.db.prepare("SELECT value FROM config WHERE key = ?").get("max_sessions_per_project");
    if (!existing) {
      this.db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run("max_sessions_per_project", "20");
    }
  }

  getConfig(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
  }

  createSession(projectPath: string): number {
    const result = this.db.prepare("INSERT INTO sessions (project_path) VALUES (?)").run(projectPath);
    this.pruneOldSessions(projectPath);
    return result.lastInsertRowid as number;
  }

  getOpenSession(projectPath: string): Session | null {
    return this.db.prepare("SELECT * FROM sessions WHERE project_path = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1").get(projectPath) as Session | null;
  }

  closeSession(sessionId: number, summary?: string): void {
    this.db.prepare("UPDATE sessions SET ended_at = datetime('now'), summary = ? WHERE id = ?").run(summary ?? null, sessionId);
  }

  discardIfEmpty(sessionId: number): void {
    const count = this.getEntryCount(sessionId);
    if (count === 0) {
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    }
  }

  addEntry(sessionId: number, type: string, content: string, outcome?: string): number {
    const count = this.getEntryCount(sessionId);
    if (count >= MAX_ENTRIES_PER_SESSION) {
      throw new Error(`Entry limit reached (${MAX_ENTRIES_PER_SESSION} per session)`);
    }

    const truncatedContent = truncate(content, MAX_CONTENT_LENGTH);
    const truncatedOutcome = outcome ? truncate(outcome, MAX_OUTCOME_LENGTH) : null;

    const result = this.db.prepare(
      "INSERT INTO entries (session_id, type, content, outcome) VALUES (?, ?, ?, ?)"
    ).run(sessionId, type, truncatedContent, truncatedOutcome);
    return result.lastInsertRowid as number;
  }

  getEntries(sessionId: number): Entry[] {
    return this.db.prepare("SELECT * FROM entries WHERE session_id = ? ORDER BY id ASC").all(sessionId) as Entry[];
  }

  getEntryCount(sessionId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM entries WHERE session_id = ?").get(sessionId) as { count: number };
    return row.count;
  }

  resolveBlocker(entryId: number, resolution: string): void {
    const truncatedResolution = truncate(resolution, MAX_OUTCOME_LENGTH);
    this.db.prepare("UPDATE entries SET resolved = 1, outcome = ? WHERE id = ? AND type = 'blocker'").run(truncatedResolution, entryId);
  }

  getBlockers(projectPath: string, resolved: boolean): Entry[] {
    return this.db.prepare(`
      SELECT e.* FROM entries e
      JOIN sessions s ON e.session_id = s.id
      WHERE s.project_path = ? AND e.type = 'blocker' AND e.resolved = ?
      ORDER BY e.created_at DESC
    `).all(projectPath, resolved ? 1 : 0) as Entry[];
  }

  getRecentSessions(projectPath: string, count: number): Session[] {
    return this.db.prepare(
      "SELECT * FROM sessions WHERE project_path = ? ORDER BY id DESC LIMIT ?"
    ).all(projectPath, count) as Session[];
  }

  private pruneOldSessions(projectPath: string): void {
    const max = parseInt(this.getConfig("max_sessions_per_project") ?? "20", 10);
    const sessions = this.db.prepare(
      "SELECT id FROM sessions WHERE project_path = ? ORDER BY id DESC"
    ).all(projectPath) as { id: number }[];

    if (sessions.length > max) {
      const toDelete = sessions.slice(max).map(s => s.id);
      const placeholders = toDelete.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM entries WHERE session_id IN (${placeholders})`).run(...toDelete);
      this.db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...toDelete);
    }
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/db.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/db.ts src/__tests__/db.test.ts
git commit -m "add database layer with sessions, entries, and config"
```

---

### Task 3: Project Detection

**Files:**
- Create: `src/project.ts`
- Create: `src/__tests__/project.test.ts`

**Step 1: Write the failing tests**

Create `src/__tests__/project.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectProject } from "../project.js";
import os from "os";

describe("detectProject", () => {
  it("finds git root from a subdirectory", () => {
    const result = detectProject(process.cwd());
    expect(result).not.toBe("_default");
    expect(result).not.toContain("src");
  });

  it("returns _default for a non-git directory", () => {
    const result = detectProject(os.tmpdir());
    expect(result).toBe("_default");
  });

  it("returns _default for undefined input", () => {
    const result = detectProject(undefined);
    expect(result).toBe("_default");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/project.test.ts`
Expected: FAIL — `detectProject` doesn't exist

**Step 3: Implement project detection**

Create `src/project.ts`:

```typescript
import { execFileSync } from "child_process";

export function detectProject(cwd: string | undefined): string {
  if (!cwd) return "_default";

  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return root;
  } catch {
    return "_default";
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/project.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/project.ts src/__tests__/project.test.ts
git commit -m "add project detection from git root"
```

---

### Task 4: Handoff Formatter

**Files:**
- Create: `src/format.ts`
- Create: `src/__tests__/format.test.ts`

Formats session data into compact one-liner summaries for the `get_handoff` and `get_history` tools.

**Step 1: Write the failing tests**

Create `src/__tests__/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatHandoff, formatHistory } from "../format.js";
import type { Session, Entry } from "../db.js";

describe("formatHandoff", () => {
  it("formats a session with entries as compact one-liners", () => {
    const session: Session = {
      id: 1,
      project_path: "/test",
      started_at: "2026-03-06 10:00:00",
      ended_at: "2026-03-06 12:00:00",
      summary: "worked on auth",
    };
    const entries: Entry[] = [
      { id: 1, session_id: 1, type: "attempt", content: "migrated auth to Clerk", outcome: "succeeded", resolved: 0, created_at: "2026-03-06 10:05:00" },
      { id: 2, session_id: 1, type: "attempt", content: "upgraded to Next 16", outcome: "failed, peer dep conflicts", resolved: 0, created_at: "2026-03-06 10:30:00" },
      { id: 3, session_id: 1, type: "blocker", content: "convex SDK doesn't support React 19", outcome: null, resolved: 0, created_at: "2026-03-06 11:00:00" },
      { id: 4, session_id: 1, type: "decision", content: "keeping Next 15 until convex ships update", outcome: null, resolved: 0, created_at: "2026-03-06 11:30:00" },
    ];

    const result = formatHandoff(session, entries);
    expect(result).toContain("Attempted: migrated auth to Clerk");
    expect(result).toContain("succeeded");
    expect(result).toContain("Blocker (unresolved)");
    expect(result).toContain("Decision:");
    expect(result).toContain("4 entries");
  });

  it("returns a message when no previous session exists", () => {
    const result = formatHandoff(null, []);
    expect(result).toContain("No previous session");
  });
});

describe("formatHistory", () => {
  it("formats multiple sessions", () => {
    const sessions: Array<{ session: Session; entries: Entry[] }> = [
      {
        session: { id: 2, project_path: "/test", started_at: "2026-03-06 14:00:00", ended_at: "2026-03-06 16:00:00", summary: "fixed bugs" },
        entries: [{ id: 5, session_id: 2, type: "attempt", content: "fixed login bug", outcome: "succeeded", resolved: 0, created_at: "2026-03-06 14:05:00" }],
      },
      {
        session: { id: 1, project_path: "/test", started_at: "2026-03-06 10:00:00", ended_at: "2026-03-06 12:00:00", summary: "initial work" },
        entries: [{ id: 1, session_id: 1, type: "decision", content: "using Clerk for auth", outcome: null, resolved: 0, created_at: "2026-03-06 10:05:00" }],
      },
    ];

    const result = formatHistory(sessions);
    expect(result).toContain("Session 1");
    expect(result).toContain("Session 2");
    expect(result).toContain("fixed login bug");
    expect(result).toContain("using Clerk for auth");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/format.test.ts`
Expected: FAIL — `formatHandoff` doesn't exist

**Step 3: Implement the formatter**

Create `src/format.ts`:

```typescript
import type { Session, Entry } from "./db.js";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + "Z").getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatEntry(entry: Entry): string {
  switch (entry.type) {
    case "attempt": {
      const outcome = entry.outcome ? ` → ${entry.outcome}` : "";
      return `- Attempted: ${entry.content}${outcome}`;
    }
    case "blocker": {
      const status = entry.resolved ? "resolved" : "unresolved";
      const resolution = entry.resolved && entry.outcome ? ` → ${entry.outcome}` : "";
      return `- Blocker (${status}): ${entry.content}${resolution}`;
    }
    case "decision":
      return `- Decision: ${entry.content}`;
    default:
      return `- ${entry.content}`;
  }
}

export function formatHandoff(session: Session | null, entries: Entry[]): string {
  if (!session) {
    return "No previous session found for this project.";
  }

  const lines: string[] = [];
  const ago = timeAgo(session.started_at);
  lines.push(`Last session (${ago}, ${entries.length} entries):`);
  if (session.summary) {
    lines.push(`Summary: ${session.summary}`);
  }
  lines.push("");
  for (const entry of entries) {
    lines.push(formatEntry(entry));
  }
  return lines.join("\n");
}

export function formatHistory(sessions: Array<{ session: Session; entries: Entry[] }>): string {
  if (sessions.length === 0) {
    return "No session history found for this project.";
  }

  const lines: string[] = [];
  sessions.forEach((s, i) => {
    const ago = timeAgo(s.session.started_at);
    lines.push(`### Session ${i + 1} (${ago}, ${s.entries.length} entries)`);
    if (s.session.summary) {
      lines.push(`Summary: ${s.session.summary}`);
    }
    lines.push("");
    for (const entry of s.entries) {
      lines.push(formatEntry(entry));
    }
    lines.push("");
  });
  return lines.join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/format.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/format.ts src/__tests__/format.test.ts
git commit -m "add handoff and history formatters"
```

---

### Task 5: MCP Server — Write Tools

**Files:**
- Modify: `src/index.ts`

Wire up the 5 write tools: `log_attempt`, `log_blocker`, `resolve_blocker`, `log_decision`, `end_session`.

The server needs to:
1. Initialize the database at `~/.memoir/memoir.db`
2. Detect the project from `process.cwd()`
3. Auto-create sessions on first log entry
4. Close previous open session when a new one is implicitly created

**Step 1: Implement write tools**

Replace `src/index.ts` with:

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoirDB } from "./db.js";
import { detectProject } from "./project.js";
import { formatHandoff, formatHistory } from "./format.js";
import path from "path";
import os from "os";

const DB_PATH = path.join(os.homedir(), ".memoir", "memoir.db");
const db = new MemoirDB(DB_PATH);
const projectPath = detectProject(process.cwd());

function getOrCreateSession(): number {
  const existing = db.getOpenSession(projectPath);
  if (existing) return existing.id;
  return db.createSession(projectPath);
}

const server = new McpServer({
  name: "memoir",
  version: "1.0.0",
});

// --- Write Tools ---

server.registerTool(
  "log_attempt",
  {
    title: "Log Attempt",
    description: "Record something that was tried and its outcome.",
    inputSchema: {
      content: z.string().max(500).describe("What was attempted"),
      outcome: z.string().max(300).optional().describe("What happened"),
    },
  },
  async ({ content, outcome }) => {
    const sessionId = getOrCreateSession();
    const entryId = db.addEntry(sessionId, "attempt", content, outcome);
    return { content: [{ type: "text" as const, text: `Logged attempt #${entryId}.` }] };
  }
);

server.registerTool(
  "log_blocker",
  {
    title: "Log Blocker",
    description: "Flag something that's stuck and why.",
    inputSchema: {
      content: z.string().max(500).describe("What's blocked and why"),
    },
  },
  async ({ content }) => {
    const sessionId = getOrCreateSession();
    const entryId = db.addEntry(sessionId, "blocker", content);
    return { content: [{ type: "text" as const, text: `Logged blocker #${entryId}. Use resolve_blocker with this ID when it's fixed.` }] };
  }
);

server.registerTool(
  "resolve_blocker",
  {
    title: "Resolve Blocker",
    description: "Mark a blocker as resolved.",
    inputSchema: {
      blocker_id: z.number().int().describe("ID of the blocker entry"),
      resolution: z.string().max(300).describe("What fixed it"),
    },
  },
  async ({ blocker_id, resolution }) => {
    db.resolveBlocker(blocker_id, resolution);
    return { content: [{ type: "text" as const, text: `Blocker #${blocker_id} resolved.` }] };
  }
);

server.registerTool(
  "log_decision",
  {
    title: "Log Decision",
    description: "Record a design or architecture choice and its rationale.",
    inputSchema: {
      content: z.string().max(500).describe("What was decided and why"),
    },
  },
  async ({ content }) => {
    const sessionId = getOrCreateSession();
    const entryId = db.addEntry(sessionId, "decision", content);
    return { content: [{ type: "text" as const, text: `Logged decision #${entryId}.` }] };
  }
);

server.registerTool(
  "end_session",
  {
    title: "End Session",
    description: "Explicitly close the current session with an optional summary.",
    inputSchema: {
      summary: z.string().max(500).optional().describe("High-level session summary"),
    },
  },
  async ({ summary }) => {
    const session = db.getOpenSession(projectPath);
    if (!session) {
      return { content: [{ type: "text" as const, text: "No active session to close." }] };
    }
    db.closeSession(session.id, summary);
    db.discardIfEmpty(session.id);
    return { content: [{ type: "text" as const, text: `Session closed.${summary ? " Summary saved." : ""}` }] };
  }
);

// Read tools placeholder — next task

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "add write tools: log_attempt, log_blocker, resolve_blocker, log_decision, end_session"
```

---

### Task 6: MCP Server — Read Tools

**Files:**
- Modify: `src/index.ts`

Add the 3 read tools: `get_handoff`, `get_history`, `get_blockers`. Insert before the `const transport` line, replacing the placeholder comment.

**Step 1: Add read tools**

Replace `// Read tools placeholder — next task` with:

```typescript
// --- Read Tools ---

server.registerTool(
  "get_handoff",
  {
    title: "Get Handoff",
    description: "Get a structured summary of the last session for this project. Use this at the start of a new session to understand what was previously attempted, what's blocked, and what decisions were made.",
    inputSchema: {},
  },
  async () => {
    const sessions = db.getRecentSessions(projectPath, 1);
    const lastClosed = sessions.find(s => s.ended_at !== null) ?? sessions[0] ?? null;

    if (!lastClosed) {
      return { content: [{ type: "text" as const, text: "No previous session found for this project." }] };
    }

    const entries = db.getEntries(lastClosed.id);
    const text = formatHandoff(lastClosed, entries);

    const unresolvedBlockers = db.getBlockers(projectPath, false);
    const blockerNote = unresolvedBlockers.length > 0
      ? `\n\n${unresolvedBlockers.length} unresolved blocker(s) across all sessions — use get_blockers to see them.`
      : "";

    return { content: [{ type: "text" as const, text: text + blockerNote }] };
  }
);

server.registerTool(
  "get_history",
  {
    title: "Get History",
    description: "Query past sessions for this project.",
    inputSchema: {
      sessions_back: z.number().int().min(1).max(20).optional().default(3).describe("How many sessions to return (default 3)"),
    },
  },
  async ({ sessions_back }) => {
    const sessions = db.getRecentSessions(projectPath, sessions_back);
    const sessionsWithEntries = sessions.map(session => ({
      session,
      entries: db.getEntries(session.id),
    }));
    const text = formatHistory(sessionsWithEntries);
    return { content: [{ type: "text" as const, text }] };
  }
);

server.registerTool(
  "get_blockers",
  {
    title: "Get Blockers",
    description: "List blockers across all sessions for this project.",
    inputSchema: {
      resolved: z.boolean().optional().default(false).describe("Show resolved blockers instead of unresolved (default: false)"),
    },
  },
  async ({ resolved }) => {
    const blockers = db.getBlockers(projectPath, resolved);
    if (blockers.length === 0) {
      return { content: [{ type: "text" as const, text: resolved ? "No resolved blockers." : "No unresolved blockers." }] };
    }
    const lines = blockers.map(b => {
      const status = b.resolved ? "resolved" : "unresolved";
      const resolution = b.resolved && b.outcome ? ` → ${b.outcome}` : "";
      return `- [#${b.id}] (${status}) ${b.content}${resolution}`;
    });
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "add read tools: get_handoff, get_history, get_blockers"
```

---

### Task 7: README and Publishing Setup

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Step 1: Create README.md**

Write a README covering: what it does, install instructions (Claude Code, other MCP clients), how it works (project detection, implicit sessions, rolling retention), tools table (write + read), storage details, token control, and license.

Follow the style of intercept-mcp's README: concise, scannable, no fluff.

**Step 2: Create LICENSE**

Standard MIT license with copyright holder "bighippoman".

**Step 3: Verify npm pack**

Run: `npm pack --dry-run`
Expected: Package includes `build/`, `README.md`, `LICENSE`

**Step 4: Commit**

```bash
git add README.md LICENSE
git commit -m "add README and MIT license"
```

---

### Task 8: Integration Test and First Publish

**Files:**
- Create: `src/__tests__/integration.test.ts`

End-to-end test simulating a full session lifecycle.

**Step 1: Write integration test**

Create `src/__tests__/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoirDB } from "../db.js";
import { detectProject } from "../project.js";
import { formatHandoff, formatHistory } from "../format.js";
import fs from "fs";
import path from "path";
import os from "os";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `memoir-integration-${Date.now()}.db`);
}

describe("integration: full session lifecycle", () => {
  let dbPath: string;
  let db: MemoirDB;
  const project = "/test/my-app";

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoirDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it("simulates a complete workflow: log, close, handoff, new session", () => {
    // Session 1: working on auth
    const s1 = db.createSession(project);
    db.addEntry(s1, "attempt", "migrated auth to Clerk", "succeeded");
    db.addEntry(s1, "attempt", "upgraded to Next 16", "failed, peer dep conflicts with convex");
    db.addEntry(s1, "blocker", "convex SDK doesn't support React 19 RC");
    db.addEntry(s1, "decision", "keeping Next 15 until convex ships update");
    db.closeSession(s1, "worked on auth migration");

    // New session starts — get handoff
    const sessions = db.getRecentSessions(project, 1);
    const lastSession = sessions[0];
    const entries = db.getEntries(lastSession.id);
    const handoff = formatHandoff(lastSession, entries);

    expect(handoff).toContain("4 entries");
    expect(handoff).toContain("migrated auth to Clerk");
    expect(handoff).toContain("Blocker (unresolved)");
    expect(handoff).toContain("Decision: keeping Next 15");

    // Check blockers
    const blockers = db.getBlockers(project, false);
    expect(blockers.length).toBe(1);

    // Session 2: resolve the blocker
    const s2 = db.createSession(project);
    db.resolveBlocker(blockers[0].id, "convex shipped React 19 support");
    db.addEntry(s2, "attempt", "upgraded to Next 16", "succeeded");
    db.closeSession(s2, "completed Next 16 upgrade");

    // Verify blocker is resolved
    const unresolvedBlockers = db.getBlockers(project, false);
    expect(unresolvedBlockers.length).toBe(0);

    // Check history
    const allSessions = db.getRecentSessions(project, 10);
    const history = formatHistory(allSessions.map(s => ({
      session: s,
      entries: db.getEntries(s.id),
    })));
    expect(history).toContain("Session 1");
    expect(history).toContain("Session 2");
  });

  it("detectProject returns a valid path for a git repo", () => {
    const result = detectProject(process.cwd());
    expect(result).not.toBe("_default");
  });
});
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 3: Build and verify**

Run: `npm run build && npm pack --dry-run`
Expected: Clean build, package includes expected files

**Step 4: Commit**

```bash
git add src/__tests__/integration.test.ts
git commit -m "add integration tests"
```

**Step 5: Publish to npm**

Run: `npm publish`
Expected: Published as `memoir-mcp@1.0.0`
