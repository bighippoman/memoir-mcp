import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoirDB,
  MAX_CONTENT_LENGTH,
  MAX_OUTCOME_LENGTH,
  MAX_ENTRIES_PER_SESSION,
} from "../db.js";

describe("MemoirDB", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: MemoirDB;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "memoir-test-"));
    dbPath = join(tmpDir, "test.db");
    db = new MemoirDB(dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // already closed
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Constants ──────────────────────────────────────────────────────────

  describe("constants", () => {
    it("exports MAX_CONTENT_LENGTH = 500", () => {
      expect(MAX_CONTENT_LENGTH).toBe(500);
    });

    it("exports MAX_OUTCOME_LENGTH = 300", () => {
      expect(MAX_OUTCOME_LENGTH).toBe(300);
    });

    it("exports MAX_ENTRIES_PER_SESSION = 50", () => {
      expect(MAX_ENTRIES_PER_SESSION).toBe(50);
    });
  });

  // ── Database creation ─────────────────────────────────────────────────

  describe("database creation", () => {
    it("creates the database file", () => {
      expect(db).toBeDefined();
    });

    it("creates parent directories if they do not exist", () => {
      const nestedPath = join(tmpDir, "a", "b", "c", "nested.db");
      const nestedDb = new MemoirDB(nestedPath);
      nestedDb.close();
      // If we got here without error, parent dirs were created
      expect(true).toBe(true);
    });

    it("sets default config max_sessions_per_project = 20", () => {
      expect(db.getConfig("max_sessions_per_project")).toBe("20");
    });
  });

  // ── Config ────────────────────────────────────────────────────────────

  describe("config", () => {
    it("getConfig returns null for unknown key", () => {
      expect(db.getConfig("nonexistent")).toBeNull();
    });

    it("setConfig / getConfig round-trip", () => {
      db.setConfig("custom_key", "custom_value");
      expect(db.getConfig("custom_key")).toBe("custom_value");
    });

    it("setConfig overwrites existing key", () => {
      db.setConfig("max_sessions_per_project", "50");
      expect(db.getConfig("max_sessions_per_project")).toBe("50");
    });
  });

  // ── Sessions ──────────────────────────────────────────────────────────

  describe("sessions", () => {
    it("createSession returns a numeric id", () => {
      const id = db.createSession("/project/path");
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("getOpenSession returns the open session", () => {
      const id = db.createSession("/project/path");
      const session = db.getOpenSession("/project/path");
      expect(session).not.toBeNull();
      expect(session!.id).toBe(id);
      expect(session!.project_path).toBe("/project/path");
      expect(session!.ended_at).toBeNull();
      expect(session!.summary).toBeNull();
    });

    it("getOpenSession returns null when no open session exists", () => {
      expect(db.getOpenSession("/project/path")).toBeNull();
    });

    it("getOpenSession returns null after session is closed", () => {
      const id = db.createSession("/project/path");
      db.closeSession(id);
      expect(db.getOpenSession("/project/path")).toBeNull();
    });

    it("closeSession sets ended_at", () => {
      const id = db.createSession("/project/path");
      db.closeSession(id);
      const sessions = db.getRecentSessions("/project/path", 1);
      expect(sessions[0].ended_at).not.toBeNull();
    });

    it("closeSession sets optional summary", () => {
      const id = db.createSession("/project/path");
      db.closeSession(id, "Session summary");
      const sessions = db.getRecentSessions("/project/path", 1);
      expect(sessions[0].summary).toBe("Session summary");
    });

    it("closeSession without summary leaves summary null", () => {
      const id = db.createSession("/project/path");
      db.closeSession(id);
      const sessions = db.getRecentSessions("/project/path", 1);
      expect(sessions[0].summary).toBeNull();
    });

    it("getRecentSessions returns sessions ordered by id DESC", () => {
      const id1 = db.createSession("/project/path");
      db.closeSession(id1);
      const id2 = db.createSession("/project/path");
      db.closeSession(id2);
      const id3 = db.createSession("/project/path");

      const sessions = db.getRecentSessions("/project/path", 10);
      expect(sessions.length).toBe(3);
      expect(sessions[0].id).toBe(id3);
      expect(sessions[1].id).toBe(id2);
      expect(sessions[2].id).toBe(id1);
    });

    it("getRecentSessions respects count limit", () => {
      for (let i = 0; i < 5; i++) {
        const id = db.createSession("/project/path");
        db.closeSession(id);
      }
      const sessions = db.getRecentSessions("/project/path", 3);
      expect(sessions.length).toBe(3);
    });

    it("getRecentSessions filters by project_path", () => {
      db.createSession("/project/a");
      db.createSession("/project/b");
      const sessionsA = db.getRecentSessions("/project/a", 10);
      const sessionsB = db.getRecentSessions("/project/b", 10);
      expect(sessionsA.length).toBe(1);
      expect(sessionsB.length).toBe(1);
      expect(sessionsA[0].project_path).toBe("/project/a");
      expect(sessionsB[0].project_path).toBe("/project/b");
    });

    it("createSession prunes old sessions beyond max_sessions_per_project", () => {
      db.setConfig("max_sessions_per_project", "3");
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        const id = db.createSession("/project/path");
        db.closeSession(id);
        ids.push(id);
      }
      // Create one more (the 6th), which should trigger pruning
      db.createSession("/project/path");

      const sessions = db.getRecentSessions("/project/path", 100);
      // Should keep only the most recent 3 (limit) sessions
      expect(sessions.length).toBe(3);
      // The oldest sessions should have been pruned
      for (const s of sessions) {
        expect(s.id).toBeGreaterThan(ids[2]);
      }
    });

    it("createSession does not prune sessions from other projects", () => {
      db.setConfig("max_sessions_per_project", "2");
      // Create 3 sessions for project A (close them so they can be pruned)
      for (let i = 0; i < 3; i++) {
        const id = db.createSession("/project/a");
        db.closeSession(id);
      }
      // Create the 4th for project A — triggers pruning
      db.createSession("/project/a");

      // Create sessions for project B
      db.createSession("/project/b");
      db.createSession("/project/b");

      const sessionsA = db.getRecentSessions("/project/a", 100);
      const sessionsB = db.getRecentSessions("/project/b", 100);
      expect(sessionsA.length).toBe(2);
      expect(sessionsB.length).toBe(2);
    });
  });

  // ── Empty session discard ─────────────────────────────────────────────

  describe("discardIfEmpty", () => {
    it("deletes session with 0 entries", () => {
      const id = db.createSession("/project/path");
      db.discardIfEmpty(id);
      expect(db.getOpenSession("/project/path")).toBeNull();
      expect(db.getRecentSessions("/project/path", 10).length).toBe(0);
    });

    it("does not delete session with entries", () => {
      const id = db.createSession("/project/path");
      db.addEntry(id, "attempt", "Did something");
      db.discardIfEmpty(id);
      expect(db.getOpenSession("/project/path")).not.toBeNull();
    });
  });

  // ── Entries ───────────────────────────────────────────────────────────

  describe("entries", () => {
    let sessionId: number;

    beforeEach(() => {
      sessionId = db.createSession("/project/path");
    });

    it("addEntry returns a numeric id", () => {
      const id = db.addEntry(sessionId, "attempt", "Tried something");
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("addEntry stores all fields correctly", () => {
      db.addEntry(sessionId, "decision", "Chose X", "Because Y");
      const entries = db.getEntries(sessionId);
      expect(entries.length).toBe(1);
      expect(entries[0].session_id).toBe(sessionId);
      expect(entries[0].type).toBe("decision");
      expect(entries[0].content).toBe("Chose X");
      expect(entries[0].outcome).toBe("Because Y");
      expect(entries[0].resolved).toBe(0);
      expect(entries[0].created_at).toBeTruthy();
    });

    it("addEntry with no outcome sets outcome to null", () => {
      db.addEntry(sessionId, "attempt", "Tried something");
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome).toBeNull();
    });

    it("getEntries returns entries ordered by id ASC", () => {
      db.addEntry(sessionId, "attempt", "First");
      db.addEntry(sessionId, "decision", "Second");
      db.addEntry(sessionId, "blocker", "Third");

      const entries = db.getEntries(sessionId);
      expect(entries.length).toBe(3);
      expect(entries[0].content).toBe("First");
      expect(entries[1].content).toBe("Second");
      expect(entries[2].content).toBe("Third");
      expect(entries[0].id).toBeLessThan(entries[1].id);
      expect(entries[1].id).toBeLessThan(entries[2].id);
    });

    it("getEntryCount returns the correct count", () => {
      expect(db.getEntryCount(sessionId)).toBe(0);
      db.addEntry(sessionId, "attempt", "A");
      expect(db.getEntryCount(sessionId)).toBe(1);
      db.addEntry(sessionId, "attempt", "B");
      expect(db.getEntryCount(sessionId)).toBe(2);
    });

    it("addEntry truncates content that exceeds MAX_CONTENT_LENGTH", () => {
      const longContent = "x".repeat(600);
      db.addEntry(sessionId, "attempt", longContent);
      const entries = db.getEntries(sessionId);
      expect(entries[0].content.length).toBe(MAX_CONTENT_LENGTH);
      expect(entries[0].content).toBe("x".repeat(MAX_CONTENT_LENGTH));
    });

    it("addEntry truncates outcome that exceeds MAX_OUTCOME_LENGTH", () => {
      const longOutcome = "y".repeat(400);
      db.addEntry(sessionId, "attempt", "content", longOutcome);
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome!.length).toBe(MAX_OUTCOME_LENGTH);
      expect(entries[0].outcome).toBe("y".repeat(MAX_OUTCOME_LENGTH));
    });

    it("addEntry throws when max entries per session is exceeded", () => {
      for (let i = 0; i < MAX_ENTRIES_PER_SESSION; i++) {
        db.addEntry(sessionId, "attempt", `Entry ${i}`);
      }
      expect(() => {
        db.addEntry(sessionId, "attempt", "One too many");
      }).toThrow();
    });

    it("addEntry allows exactly MAX_ENTRIES_PER_SESSION entries", () => {
      for (let i = 0; i < MAX_ENTRIES_PER_SESSION; i++) {
        db.addEntry(sessionId, "attempt", `Entry ${i}`);
      }
      expect(db.getEntryCount(sessionId)).toBe(MAX_ENTRIES_PER_SESSION);
    });
  });

  // ── Blockers ──────────────────────────────────────────────────────────

  describe("blockers", () => {
    it("resolveBlocker sets resolved=1 and outcome", () => {
      const sessionId = db.createSession("/project/path");
      const entryId = db.addEntry(sessionId, "blocker", "Stuck on X");

      db.resolveBlocker(entryId, "Fixed by doing Y");

      const entries = db.getEntries(sessionId);
      expect(entries[0].resolved).toBe(1);
      expect(entries[0].outcome).toBe("Fixed by doing Y");
    });

    it("getBlockers returns unresolved blockers across sessions", () => {
      const s1 = db.createSession("/project/path");
      db.addEntry(s1, "blocker", "Blocker 1");
      db.addEntry(s1, "attempt", "Not a blocker");
      db.closeSession(s1);

      const s2 = db.createSession("/project/path");
      db.addEntry(s2, "blocker", "Blocker 2");
      db.addEntry(s2, "decision", "Not a blocker either");

      const blockers = db.getBlockers("/project/path", false);
      expect(blockers.length).toBe(2);
      expect(blockers.every((b) => b.type === "blocker")).toBe(true);
      expect(blockers.every((b) => b.resolved === 0)).toBe(true);
    });

    it("getBlockers returns resolved blockers when resolved=true", () => {
      const sessionId = db.createSession("/project/path");
      const b1 = db.addEntry(sessionId, "blocker", "Blocker resolved");
      db.addEntry(sessionId, "blocker", "Blocker unresolved");
      db.resolveBlocker(b1, "Fixed");

      const resolved = db.getBlockers("/project/path", true);
      expect(resolved.length).toBe(1);
      expect(resolved[0].content).toBe("Blocker resolved");
      expect(resolved[0].resolved).toBe(1);
    });

    it("getBlockers filters by project_path", () => {
      const s1 = db.createSession("/project/a");
      db.addEntry(s1, "blocker", "Blocker in A");

      const s2 = db.createSession("/project/b");
      db.addEntry(s2, "blocker", "Blocker in B");

      const blockersA = db.getBlockers("/project/a", false);
      const blockersB = db.getBlockers("/project/b", false);
      expect(blockersA.length).toBe(1);
      expect(blockersA[0].content).toBe("Blocker in A");
      expect(blockersB.length).toBe(1);
      expect(blockersB[0].content).toBe("Blocker in B");
    });
  });

  // ── Close ─────────────────────────────────────────────────────────────

  describe("close", () => {
    it("close does not throw", () => {
      expect(() => db.close()).not.toThrow();
    });
  });
});
