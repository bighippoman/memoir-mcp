import Database from "better-sqlite3";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

export const MAX_CONTENT_LENGTH = 500;
export const MAX_OUTCOME_LENGTH = 300;
export const MAX_ENTRIES_PER_SESSION = 50;

// ── Interfaces ─────────────────────────────────────────────────────────────

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

// ── MemoirDB ───────────────────────────────────────────────────────────────

export class MemoirDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Create parent directory if needed
    mkdirSync(dirname(dbPath), { recursive: true });

    // Open database (recreate if corrupt)
    try {
      this.db = new Database(dbPath);
    } catch {
      // If corrupt, try to remove and recreate
      try {
        unlinkSync(dbPath);
      } catch {
        // file may not exist
      }
      this.db = new Database(dbPath);
    }

    // Set WAL journal mode
    this.db.pragma("journal_mode = WAL");

    // Enable foreign keys
    this.db.pragma("foreign_keys = ON");

    // Create tables
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

      CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_entries_session_id ON entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
    `);

    // Set default config
    this.db
      .prepare(
        `INSERT OR IGNORE INTO config (key, value) VALUES ('max_sessions_per_project', '20')`
      )
      .run();
  }

  // ── Config ─────────────────────────────────────────────────────────────

  getConfig(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setConfig(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  }

  // ── Sessions ───────────────────────────────────────────────────────────

  createSession(projectPath: string): number {
    const result = this.db
      .prepare("INSERT INTO sessions (project_path) VALUES (?)")
      .run(projectPath);
    const sessionId = Number(result.lastInsertRowid);

    // Prune old sessions beyond the configured limit
    this.pruneOldSessions(projectPath);

    return sessionId;
  }

  private pruneOldSessions(projectPath: string): void {
    const maxStr = this.getConfig("max_sessions_per_project");
    const max = maxStr ? parseInt(maxStr, 10) : 20;

    // Find the id cutoff — keep only the most recent `max` sessions
    const cutoff = this.db
      .prepare(
        `SELECT id FROM sessions
         WHERE project_path = ?
         ORDER BY id DESC
         LIMIT 1 OFFSET ?`
      )
      .get(projectPath, max) as { id: number } | undefined;

    if (cutoff) {
      this.db
        .prepare(
          `DELETE FROM sessions
           WHERE project_path = ? AND id <= ?`
        )
        .run(projectPath, cutoff.id);
    }
  }

  getOpenSession(projectPath: string): Session | null {
    const row = this.db
      .prepare(
        `SELECT id, project_path, started_at, ended_at, summary
         FROM sessions
         WHERE project_path = ? AND ended_at IS NULL
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(projectPath) as Session | undefined;
    return row ?? null;
  }

  closeSession(sessionId: number, summary?: string): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET ended_at = datetime('now'), summary = ?
         WHERE id = ?`
      )
      .run(summary ?? null, sessionId);
  }

  discardIfEmpty(sessionId: number): void {
    const count = this.getEntryCount(sessionId);
    if (count === 0) {
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    }
  }

  getRecentSessions(projectPath: string, count: number): Session[] {
    return this.db
      .prepare(
        `SELECT id, project_path, started_at, ended_at, summary
         FROM sessions
         WHERE project_path = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(projectPath, count) as Session[];
  }

  // ── Entries ────────────────────────────────────────────────────────────

  addEntry(
    sessionId: number,
    type: string,
    content: string,
    outcome?: string
  ): number {
    // Check max entries limit
    const currentCount = this.getEntryCount(sessionId);
    if (currentCount >= MAX_ENTRIES_PER_SESSION) {
      throw new Error(
        `Session ${sessionId} has reached the maximum of ${MAX_ENTRIES_PER_SESSION} entries`
      );
    }

    // Truncate content and outcome if needed
    const truncatedContent = content.slice(0, MAX_CONTENT_LENGTH);
    const truncatedOutcome =
      outcome != null ? outcome.slice(0, MAX_OUTCOME_LENGTH) : null;

    const result = this.db
      .prepare(
        `INSERT INTO entries (session_id, type, content, outcome)
         VALUES (?, ?, ?, ?)`
      )
      .run(sessionId, type, truncatedContent, truncatedOutcome);

    return Number(result.lastInsertRowid);
  }

  getEntries(sessionId: number): Entry[] {
    return this.db
      .prepare(
        `SELECT id, session_id, type, content, outcome, resolved, created_at
         FROM entries
         WHERE session_id = ?
         ORDER BY id ASC`
      )
      .all(sessionId) as Entry[];
  }

  getEntryCount(sessionId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM entries WHERE session_id = ?")
      .get(sessionId) as { count: number };
    return row.count;
  }

  // ── Blockers ───────────────────────────────────────────────────────────

  resolveBlocker(entryId: number, resolution: string): void {
    this.db
      .prepare(
        `UPDATE entries
         SET resolved = 1, outcome = ?
         WHERE id = ? AND type = 'blocker'`
      )
      .run(resolution, entryId);
  }

  getBlockers(projectPath: string, resolved: boolean): Entry[] {
    const resolvedInt = resolved ? 1 : 0;
    return this.db
      .prepare(
        `SELECT e.id, e.session_id, e.type, e.content, e.outcome, e.resolved, e.created_at
         FROM entries e
         JOIN sessions s ON e.session_id = s.id
         WHERE s.project_path = ?
           AND e.type = 'blocker'
           AND e.resolved = ?
         ORDER BY e.id ASC`
      )
      .all(projectPath, resolvedInt) as Entry[];
  }

  // ── Close ──────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
