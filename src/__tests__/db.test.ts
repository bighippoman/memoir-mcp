import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoirDB,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_MAX_OUTCOME_LENGTH,
  DEFAULT_MAX_ENTRIES_PER_SESSION,
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
    it("exports DEFAULT_MAX_CONTENT_LENGTH = 500", () => {
      expect(DEFAULT_MAX_CONTENT_LENGTH).toBe(500);
    });

    it("exports DEFAULT_MAX_OUTCOME_LENGTH = 300", () => {
      expect(DEFAULT_MAX_OUTCOME_LENGTH).toBe(300);
    });

    it("exports DEFAULT_MAX_ENTRIES_PER_SESSION = 50", () => {
      expect(DEFAULT_MAX_ENTRIES_PER_SESSION).toBe(50);
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

    it("addEntry truncates content that exceeds DEFAULT_MAX_CONTENT_LENGTH", () => {
      const longContent = "x".repeat(600);
      db.addEntry(sessionId, "attempt", longContent);
      const entries = db.getEntries(sessionId);
      expect(entries[0].content.length).toBe(DEFAULT_MAX_CONTENT_LENGTH);
      expect(entries[0].content).toBe("x".repeat(DEFAULT_MAX_CONTENT_LENGTH));
    });

    it("addEntry truncates outcome that exceeds DEFAULT_MAX_OUTCOME_LENGTH", () => {
      const longOutcome = "y".repeat(400);
      db.addEntry(sessionId, "attempt", "content", longOutcome);
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome!.length).toBe(DEFAULT_MAX_OUTCOME_LENGTH);
      expect(entries[0].outcome).toBe("y".repeat(DEFAULT_MAX_OUTCOME_LENGTH));
    });

    it("addEntry throws when max entries per session is exceeded", () => {
      for (let i = 0; i < DEFAULT_MAX_ENTRIES_PER_SESSION; i++) {
        db.addEntry(sessionId, "attempt", `Entry ${i}`);
      }
      expect(() => {
        db.addEntry(sessionId, "attempt", "One too many");
      }).toThrow();
    });

    it("addEntry allows exactly DEFAULT_MAX_ENTRIES_PER_SESSION entries", () => {
      for (let i = 0; i < DEFAULT_MAX_ENTRIES_PER_SESSION; i++) {
        db.addEntry(sessionId, "attempt", `Entry ${i}`);
      }
      expect(db.getEntryCount(sessionId)).toBe(DEFAULT_MAX_ENTRIES_PER_SESSION);
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

  // ── Session edge cases ───────────────────────────────────────────────

  describe("session edge cases", () => {
    it("multiple projects don't interfere with each other", () => {
      const idA = db.createSession("/project/a");
      const idB = db.createSession("/project/b");

      const openA = db.getOpenSession("/project/a");
      const openB = db.getOpenSession("/project/b");

      expect(openA).not.toBeNull();
      expect(openB).not.toBeNull();
      expect(openA!.id).toBe(idA);
      expect(openB!.id).toBe(idB);
      expect(openA!.project_path).toBe("/project/a");
      expect(openB!.project_path).toBe("/project/b");
    });

    it("creating a session while another is open for the same project returns a new id", () => {
      const id1 = db.createSession("/project/path");
      const id2 = db.createSession("/project/path");

      expect(id2).toBeGreaterThan(id1);
      // getOpenSession returns the most recent open session
      const open = db.getOpenSession("/project/path");
      expect(open!.id).toBe(id2);
    });

    it("closeSession with a non-existent session ID does not throw", () => {
      expect(() => db.closeSession(99999)).not.toThrow();
    });

    it("closeSession called twice on the same session does not throw", () => {
      const id = db.createSession("/project/path");
      db.closeSession(id, "first close");
      expect(() => db.closeSession(id, "second close")).not.toThrow();

      // The summary should be overwritten to the second call
      const sessions = db.getRecentSessions("/project/path", 1);
      expect(sessions[0].summary).toBe("second close");
    });

    it("getRecentSessions with count=0 returns empty array", () => {
      db.createSession("/project/path");
      const sessions = db.getRecentSessions("/project/path", 0);
      expect(sessions).toEqual([]);
    });

    it("getRecentSessions with count larger than total sessions returns all sessions", () => {
      db.createSession("/project/path");
      db.createSession("/project/path");
      const sessions = db.getRecentSessions("/project/path", 100);
      expect(sessions.length).toBe(2);
    });

    it("session ordering is correct (most recent first)", () => {
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        const id = db.createSession("/project/path");
        db.closeSession(id, `session ${i}`);
        ids.push(id);
      }

      const sessions = db.getRecentSessions("/project/path", 5);
      expect(sessions.length).toBe(5);
      // Most recent first
      for (let i = 0; i < sessions.length - 1; i++) {
        expect(sessions[i].id).toBeGreaterThan(sessions[i + 1].id);
      }
      expect(sessions[0].id).toBe(ids[4]);
      expect(sessions[4].id).toBe(ids[0]);
    });

    it("getOpenSession returns null for a project that never had sessions", () => {
      expect(db.getOpenSession("/nonexistent/project")).toBeNull();
    });

    it("getRecentSessions returns empty for a project with no sessions", () => {
      const sessions = db.getRecentSessions("/nonexistent/project", 10);
      expect(sessions).toEqual([]);
    });
  });

  // ── Entry edge cases ────────────────────────────────────────────────

  describe("entry edge cases", () => {
    let sessionId: number;

    beforeEach(() => {
      sessionId = db.createSession("/project/path");
    });

    it("addEntry with empty string content stores empty string", () => {
      db.addEntry(sessionId, "attempt", "");
      const entries = db.getEntries(sessionId);
      expect(entries[0].content).toBe("");
    });

    it("addEntry with exactly 500 chars content stores full content", () => {
      const content = "a".repeat(500);
      db.addEntry(sessionId, "attempt", content);
      const entries = db.getEntries(sessionId);
      expect(entries[0].content.length).toBe(500);
      expect(entries[0].content).toBe(content);
    });

    it("addEntry with exactly 501 chars content truncates to 500", () => {
      const content = "a".repeat(501);
      db.addEntry(sessionId, "attempt", content);
      const entries = db.getEntries(sessionId);
      expect(entries[0].content.length).toBe(500);
      expect(entries[0].content).toBe("a".repeat(500));
    });

    it("addEntry with exactly 300 char outcome stores full outcome", () => {
      const outcome = "b".repeat(300);
      db.addEntry(sessionId, "attempt", "test", outcome);
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome!.length).toBe(300);
      expect(entries[0].outcome).toBe(outcome);
    });

    it("addEntry with exactly 301 char outcome truncates to 300", () => {
      const outcome = "b".repeat(301);
      db.addEntry(sessionId, "attempt", "test", outcome);
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome!.length).toBe(300);
      expect(entries[0].outcome).toBe("b".repeat(300));
    });

    it("adding exactly 50 entries succeeds", () => {
      for (let i = 0; i < 50; i++) {
        db.addEntry(sessionId, "attempt", `Entry ${i}`);
      }
      expect(db.getEntryCount(sessionId)).toBe(50);
    });

    it("adding entry #51 throws an error", () => {
      for (let i = 0; i < 50; i++) {
        db.addEntry(sessionId, "attempt", `Entry ${i}`);
      }
      expect(() => db.addEntry(sessionId, "attempt", "Entry 50")).toThrow(
        /maximum of 50 entries/
      );
    });

    it("getEntries on a session with 0 entries returns empty array", () => {
      const entries = db.getEntries(sessionId);
      expect(entries).toEqual([]);
    });

    it("getEntries on a non-existent session ID returns empty array", () => {
      const entries = db.getEntries(99999);
      expect(entries).toEqual([]);
    });

    it("invalid entry type is rejected by the database CHECK constraint", () => {
      expect(() => db.addEntry(sessionId, "invalid_type", "test")).toThrow();
    });

    it("all valid entry types are accepted", () => {
      const id1 = db.addEntry(sessionId, "attempt", "test attempt");
      const id2 = db.addEntry(sessionId, "blocker", "test blocker");
      const id3 = db.addEntry(sessionId, "decision", "test decision");
      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThan(0);
      expect(id3).toBeGreaterThan(0);
    });

    it("addEntry with undefined outcome stores null", () => {
      db.addEntry(sessionId, "attempt", "test", undefined);
      const entries = db.getEntries(sessionId);
      expect(entries[0].outcome).toBeNull();
    });

    it("getEntryCount on a non-existent session returns 0", () => {
      expect(db.getEntryCount(99999)).toBe(0);
    });

    it("entries from different sessions do not mix", () => {
      const s1 = db.createSession("/project/a");
      const s2 = db.createSession("/project/b");

      db.addEntry(s1, "attempt", "entry for A");
      db.addEntry(s2, "attempt", "entry for B");

      const entriesA = db.getEntries(s1);
      const entriesB = db.getEntries(s2);

      expect(entriesA.length).toBe(1);
      expect(entriesB.length).toBe(1);
      expect(entriesA[0].content).toBe("entry for A");
      expect(entriesB[0].content).toBe("entry for B");
    });
  });

  // ── Blocker edge cases ──────────────────────────────────────────────

  describe("blocker edge cases", () => {
    it("resolveBlocker on a non-blocker entry (attempt) does not change it", () => {
      const sessionId = db.createSession("/project/path");
      const entryId = db.addEntry(sessionId, "attempt", "Just an attempt");
      db.resolveBlocker(entryId, "Trying to resolve an attempt");

      const entries = db.getEntries(sessionId);
      expect(entries[0].resolved).toBe(0);
      // outcome should remain null since resolveBlocker only updates type='blocker'
      expect(entries[0].outcome).toBeNull();
    });

    it("resolveBlocker on a decision entry does not change it", () => {
      const sessionId = db.createSession("/project/path");
      const entryId = db.addEntry(sessionId, "decision", "A decision");
      db.resolveBlocker(entryId, "Trying to resolve a decision");

      const entries = db.getEntries(sessionId);
      expect(entries[0].resolved).toBe(0);
      expect(entries[0].outcome).toBeNull();
    });

    it("resolveBlocker on already-resolved blocker overwrites the resolution", () => {
      const sessionId = db.createSession("/project/path");
      const entryId = db.addEntry(sessionId, "blocker", "Stuck");
      db.resolveBlocker(entryId, "First fix");
      db.resolveBlocker(entryId, "Better fix");

      const entries = db.getEntries(sessionId);
      expect(entries[0].resolved).toBe(1);
      expect(entries[0].outcome).toBe("Better fix");
    });

    it("resolveBlocker with non-existent entry ID does not throw", () => {
      expect(() => db.resolveBlocker(99999, "some fix")).not.toThrow();
    });

    it("getBlockers when there are no sessions at all returns empty array", () => {
      const blockers = db.getBlockers("/project/path", false);
      expect(blockers).toEqual([]);
    });

    it("getBlockers with multiple projects only returns blockers for specified project", () => {
      const s1 = db.createSession("/project/a");
      db.addEntry(s1, "blocker", "Blocker A1");
      db.addEntry(s1, "blocker", "Blocker A2");

      const s2 = db.createSession("/project/b");
      db.addEntry(s2, "blocker", "Blocker B1");

      const blockersA = db.getBlockers("/project/a", false);
      const blockersB = db.getBlockers("/project/b", false);

      expect(blockersA.length).toBe(2);
      expect(blockersB.length).toBe(1);
      expect(blockersA[0].content).toBe("Blocker A1");
      expect(blockersA[1].content).toBe("Blocker A2");
      expect(blockersB[0].content).toBe("Blocker B1");
    });

    it("getBlockers returns blockers ordered by id ASC", () => {
      const s = db.createSession("/project/path");
      db.addEntry(s, "blocker", "First blocker");
      db.addEntry(s, "blocker", "Second blocker");
      db.addEntry(s, "blocker", "Third blocker");

      const blockers = db.getBlockers("/project/path", false);
      expect(blockers.length).toBe(3);
      expect(blockers[0].content).toBe("First blocker");
      expect(blockers[1].content).toBe("Second blocker");
      expect(blockers[2].content).toBe("Third blocker");
      expect(blockers[0].id).toBeLessThan(blockers[1].id);
      expect(blockers[1].id).toBeLessThan(blockers[2].id);
    });

    it("getBlockers resolved=true returns empty when none are resolved", () => {
      const s = db.createSession("/project/path");
      db.addEntry(s, "blocker", "Unresolved blocker");
      const resolved = db.getBlockers("/project/path", true);
      expect(resolved).toEqual([]);
    });

    it("getBlockers resolved=false returns empty when all are resolved", () => {
      const s = db.createSession("/project/path");
      const b = db.addEntry(s, "blocker", "Will be resolved");
      db.resolveBlocker(b, "Fixed");
      const unresolved = db.getBlockers("/project/path", false);
      expect(unresolved).toEqual([]);
    });
  });

  // ── Pruning edge cases ──────────────────────────────────────────────

  describe("pruning edge cases", () => {
    it("pruning deletes associated entries (not just sessions)", () => {
      db.setConfig("max_sessions_per_project", "3");

      const s1 = db.createSession("/project/path");
      db.addEntry(s1, "attempt", "Old entry 1");
      db.addEntry(s1, "blocker", "Old blocker 1");
      db.closeSession(s1);

      const s2 = db.createSession("/project/path");
      db.addEntry(s2, "attempt", "Entry 2");
      db.closeSession(s2);

      const s3 = db.createSession("/project/path");
      db.addEntry(s3, "attempt", "Entry 3");
      db.closeSession(s3);

      // Creating s4 triggers pruning — keeps s2, s3, s4 (3 most recent)
      db.createSession("/project/path");

      // Entries from s1 should be gone (cascade delete)
      const entriesS1 = db.getEntries(s1);
      expect(entriesS1).toEqual([]);

      // Entries from s2 and s3 should still exist
      const entriesS2 = db.getEntries(s2);
      expect(entriesS2.length).toBeGreaterThan(0);
      const entriesS3 = db.getEntries(s3);
      expect(entriesS3.length).toBeGreaterThan(0);
    });

    it("pruning with exactly max sessions does not prune", () => {
      db.setConfig("max_sessions_per_project", "3");

      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const id = db.createSession("/project/path");
        db.closeSession(id);
        ids.push(id);
      }

      const sessions = db.getRecentSessions("/project/path", 100);
      expect(sessions.length).toBe(3);
    });

    it("pruning with max+1 sessions prunes exactly 1", () => {
      db.setConfig("max_sessions_per_project", "3");

      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const id = db.createSession("/project/path");
        db.closeSession(id);
        ids.push(id);
      }

      // 4th session triggers pruning — should prune exactly 1 (the oldest)
      db.createSession("/project/path");

      const sessions = db.getRecentSessions("/project/path", 100);
      expect(sessions.length).toBe(3);

      // The oldest session should be pruned
      const sessionIds = sessions.map((s) => s.id);
      expect(sessionIds).not.toContain(ids[0]);
      expect(sessionIds).toContain(ids[1]);
      expect(sessionIds).toContain(ids[2]);
    });

    it("pruned session entries are actually gone from the database", () => {
      db.setConfig("max_sessions_per_project", "1");

      const s1 = db.createSession("/project/path");
      const e1 = db.addEntry(s1, "blocker", "Old blocker");
      db.closeSession(s1);

      // This triggers pruning of s1
      db.createSession("/project/path");

      // The entry from s1 should be gone
      const entries = db.getEntries(s1);
      expect(entries).toEqual([]);

      // The blocker should also be gone from getBlockers
      const blockers = db.getBlockers("/project/path", false);
      const oldBlocker = blockers.find((b) => b.id === e1);
      expect(oldBlocker).toBeUndefined();
    });
  });

  // ── Config edge cases ───────────────────────────────────────────────

  describe("config edge cases", () => {
    it("getConfig for non-existent key returns null", () => {
      expect(db.getConfig("totally_nonexistent_key")).toBeNull();
    });

    it("setConfig overwrites existing value", () => {
      db.setConfig("test_key", "value1");
      expect(db.getConfig("test_key")).toBe("value1");
      db.setConfig("test_key", "value2");
      expect(db.getConfig("test_key")).toBe("value2");
    });

    it("max_sessions_per_project with value '1' works as extreme limit", () => {
      db.setConfig("max_sessions_per_project", "1");

      const s1 = db.createSession("/project/path");
      db.closeSession(s1);

      // Creating s2 should prune s1
      const s2 = db.createSession("/project/path");

      const sessions = db.getRecentSessions("/project/path", 100);
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe(s2);
    });

    it("setConfig with empty string value", () => {
      db.setConfig("test_key", "");
      expect(db.getConfig("test_key")).toBe("");
    });

    it("max_sessions_per_project respects constructor options on re-open", () => {
      db.setConfig("max_sessions_per_project", "50");
      // Re-open without options — resets to default 20
      const db2 = new MemoirDB(dbPath);
      expect(db2.getConfig("max_sessions_per_project")).toBe("20");
      db2.close();

      // Re-open with custom option — uses that value
      const db3 = new MemoirDB(dbPath, { maxSessionsPerProject: 100 });
      expect(db3.getConfig("max_sessions_per_project")).toBe("100");
      db3.close();
    });
  });

  // ── discardIfEmpty edge cases ───────────────────────────────────────

  describe("discardIfEmpty edge cases", () => {
    it("discardIfEmpty on session with entries keeps it", () => {
      const id = db.createSession("/project/path");
      db.addEntry(id, "attempt", "Something");
      db.discardIfEmpty(id);

      const sessions = db.getRecentSessions("/project/path", 10);
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe(id);
    });

    it("discardIfEmpty on non-existent session does not crash", () => {
      expect(() => db.discardIfEmpty(99999)).not.toThrow();
    });

    it("discardIfEmpty on already-discarded session does not crash", () => {
      const id = db.createSession("/project/path");
      db.discardIfEmpty(id); // deletes it
      expect(() => db.discardIfEmpty(id)).not.toThrow(); // no-op
    });

    it("discardIfEmpty on a closed empty session still deletes it", () => {
      const id = db.createSession("/project/path");
      db.closeSession(id, "empty session summary");
      db.discardIfEmpty(id);

      const sessions = db.getRecentSessions("/project/path", 10);
      expect(sessions.length).toBe(0);
    });
  });

  // ── Custom options ──────────────────────────────────────────────────

  describe("custom options", () => {
    it("uses default values when no options are provided", () => {
      expect(db.maxContentLength).toBe(500);
      expect(db.maxOutcomeLength).toBe(300);
      expect(db.maxEntriesPerSession).toBe(50);
      expect(db.maxSessionsPerProject).toBe(20);
    });

    it("accepts custom maxContentLength", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom1.db"), { maxContentLength: 100 });
      expect(customDb.maxContentLength).toBe(100);

      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "x".repeat(200));
      const entries = customDb.getEntries(s);
      expect(entries[0].content.length).toBe(100);
      customDb.close();
    });

    it("accepts custom maxOutcomeLength", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom2.db"), { maxOutcomeLength: 50 });
      expect(customDb.maxOutcomeLength).toBe(50);

      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "test", "y".repeat(100));
      const entries = customDb.getEntries(s);
      expect(entries[0].outcome!.length).toBe(50);
      customDb.close();
    });

    it("accepts custom maxEntriesPerSession", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom3.db"), { maxEntriesPerSession: 5 });
      expect(customDb.maxEntriesPerSession).toBe(5);

      const s = customDb.createSession("/test");
      for (let i = 0; i < 5; i++) {
        customDb.addEntry(s, "attempt", `Entry ${i}`);
      }
      expect(customDb.getEntryCount(s)).toBe(5);
      expect(() => customDb.addEntry(s, "attempt", "Too many")).toThrow(/maximum of 5 entries/);
      customDb.close();
    });

    it("accepts custom maxSessionsPerProject", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom4.db"), { maxSessionsPerProject: 3 });
      expect(customDb.maxSessionsPerProject).toBe(3);
      expect(customDb.getConfig("max_sessions_per_project")).toBe("3");

      // Create 4 sessions — should prune to 3
      for (let i = 0; i < 3; i++) {
        const id = customDb.createSession("/test");
        customDb.closeSession(id);
      }
      customDb.createSession("/test");

      const sessions = customDb.getRecentSessions("/test", 100);
      expect(sessions.length).toBe(3);
      customDb.close();
    });

    it("accepts all custom options at once", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom5.db"), {
        maxContentLength: 50,
        maxOutcomeLength: 25,
        maxEntriesPerSession: 3,
        maxSessionsPerProject: 2,
      });

      expect(customDb.maxContentLength).toBe(50);
      expect(customDb.maxOutcomeLength).toBe(25);
      expect(customDb.maxEntriesPerSession).toBe(3);
      expect(customDb.maxSessionsPerProject).toBe(2);

      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "a".repeat(100), "b".repeat(100));
      const entries = customDb.getEntries(s);
      expect(entries[0].content.length).toBe(50);
      expect(entries[0].outcome!.length).toBe(25);
      customDb.close();
    });

    it("accepts partial options — unset fields use defaults", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom6.db"), { maxContentLength: 200 });
      expect(customDb.maxContentLength).toBe(200);
      expect(customDb.maxOutcomeLength).toBe(300); // default
      expect(customDb.maxEntriesPerSession).toBe(50); // default
      expect(customDb.maxSessionsPerProject).toBe(20); // default
      customDb.close();
    });

    it("custom maxContentLength allows longer content than default", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom7.db"), { maxContentLength: 1000 });
      const s = customDb.createSession("/test");
      const longContent = "z".repeat(800);
      customDb.addEntry(s, "attempt", longContent);
      const entries = customDb.getEntries(s);
      // 800 chars would be truncated to 500 with default, but should be kept with custom 1000
      expect(entries[0].content.length).toBe(800);
      expect(entries[0].content).toBe(longContent);
      customDb.close();
    });

    it("custom maxOutcomeLength allows longer outcomes than default", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom8.db"), { maxOutcomeLength: 600 });
      const s = customDb.createSession("/test");
      const longOutcome = "w".repeat(500);
      customDb.addEntry(s, "attempt", "test", longOutcome);
      const entries = customDb.getEntries(s);
      // 500 chars would be truncated to 300 with default, but should be kept with custom 600
      expect(entries[0].outcome!.length).toBe(500);
      expect(entries[0].outcome).toBe(longOutcome);
      customDb.close();
    });

    it("custom maxEntriesPerSession allows more entries than default", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom9.db"), { maxEntriesPerSession: 100 });
      const s = customDb.createSession("/test");
      // Add 75 entries — would fail with default limit of 50
      for (let i = 0; i < 75; i++) {
        customDb.addEntry(s, "attempt", `Entry ${i}`);
      }
      expect(customDb.getEntryCount(s)).toBe(75);
      customDb.close();
    });

    it("custom maxEntriesPerSession with lower value restricts earlier", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom10.db"), { maxEntriesPerSession: 2 });
      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "First");
      customDb.addEntry(s, "attempt", "Second");
      expect(() => customDb.addEntry(s, "attempt", "Third")).toThrow(/maximum of 2 entries/);
      customDb.close();
    });

    it("custom maxContentLength truncates at exact boundary", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom11.db"), { maxContentLength: 10 });
      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "1234567890abc");
      const entries = customDb.getEntries(s);
      expect(entries[0].content).toBe("1234567890");
      expect(entries[0].content.length).toBe(10);
      customDb.close();
    });

    it("custom maxOutcomeLength truncates at exact boundary", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom12.db"), { maxOutcomeLength: 8 });
      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "test", "abcdefghijk");
      const entries = customDb.getEntries(s);
      expect(entries[0].outcome).toBe("abcdefgh");
      expect(entries[0].outcome!.length).toBe(8);
      customDb.close();
    });

    it("content exactly at custom limit is not truncated", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom13.db"), { maxContentLength: 10 });
      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "1234567890");
      const entries = customDb.getEntries(s);
      expect(entries[0].content).toBe("1234567890");
      customDb.close();
    });

    it("outcome exactly at custom limit is not truncated", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom14.db"), { maxOutcomeLength: 10 });
      const s = customDb.createSession("/test");
      customDb.addEntry(s, "attempt", "test", "1234567890");
      const entries = customDb.getEntries(s);
      expect(entries[0].outcome).toBe("1234567890");
      customDb.close();
    });

    it("re-opening DB with different options applies new limits", () => {
      // First instance with custom limits
      const db1 = new MemoirDB(join(tmpDir, "reopen.db"), { maxSessionsPerProject: 5 });
      expect(db1.getConfig("max_sessions_per_project")).toBe("5");
      db1.close();

      // Re-open with different limits
      const db2 = new MemoirDB(join(tmpDir, "reopen.db"), { maxSessionsPerProject: 10 });
      expect(db2.getConfig("max_sessions_per_project")).toBe("10");
      expect(db2.maxSessionsPerProject).toBe(10);
      db2.close();

      // Re-open with no options — falls back to defaults
      const db3 = new MemoirDB(join(tmpDir, "reopen.db"));
      expect(db3.getConfig("max_sessions_per_project")).toBe("20");
      expect(db3.maxSessionsPerProject).toBe(20);
      db3.close();
    });

    it("custom maxSessionsPerProject=1 keeps only the latest session", () => {
      const customDb = new MemoirDB(join(tmpDir, "custom15.db"), { maxSessionsPerProject: 1 });
      const s1 = customDb.createSession("/test");
      customDb.addEntry(s1, "attempt", "old work");
      customDb.closeSession(s1);

      const s2 = customDb.createSession("/test");
      customDb.addEntry(s2, "attempt", "new work");

      const sessions = customDb.getRecentSessions("/test", 100);
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe(s2);

      // Old entries should be gone
      expect(customDb.getEntries(s1)).toEqual([]);
      customDb.close();
    });
  });

  // ── Close ─────────────────────────────────────────────────────────────

  describe("close", () => {
    it("close does not throw", () => {
      expect(() => db.close()).not.toThrow();
    });
  });
});
