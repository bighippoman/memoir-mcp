import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoirDB, MAX_ENTRIES_PER_SESSION } from "../db.js";
import { detectProject } from "../project.js";
import { formatHandoff, formatHistory, formatEntry } from "../format.js";
import fs from "fs";
import path from "path";
import os from "os";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `memoir-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

  it("session with all 50 entries, then handoff", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));

    const s1 = db.createSession(project);
    for (let i = 0; i < MAX_ENTRIES_PER_SESSION; i++) {
      const types = ["attempt", "blocker", "decision"] as const;
      const type = types[i % 3];
      db.addEntry(s1, type, `Entry ${i}`, type === "attempt" ? `Outcome ${i}` : undefined);
    }
    db.closeSession(s1, "Full session with 50 entries");

    const sessions = db.getRecentSessions(project, 1);
    const entries = db.getEntries(sessions[0].id);
    expect(entries.length).toBe(50);

    const handoff = formatHandoff(sessions[0], entries);
    expect(handoff).toContain("50 entries");
    expect(handoff).toContain("Summary: Full session with 50 entries");

    // Verify all entry types appear
    expect(handoff).toContain("Attempted:");
    expect(handoff).toContain("Blocker");
    expect(handoff).toContain("Decision:");

    vi.useRealTimers();
  });

  it("multiple projects in the same database, verify isolation", () => {
    const projectA = "/test/project-a";
    const projectB = "/test/project-b";

    // Create sessions and entries for both projects
    const sA = db.createSession(projectA);
    db.addEntry(sA, "attempt", "work on A", "done");
    db.addEntry(sA, "blocker", "A blocker");
    db.closeSession(sA, "finished A work");

    const sB = db.createSession(projectB);
    db.addEntry(sB, "attempt", "work on B", "done");
    db.addEntry(sB, "decision", "B decision");
    db.closeSession(sB, "finished B work");

    // Verify sessions are isolated
    const sessionsA = db.getRecentSessions(projectA, 10);
    const sessionsB = db.getRecentSessions(projectB, 10);
    expect(sessionsA.length).toBe(1);
    expect(sessionsB.length).toBe(1);
    expect(sessionsA[0].project_path).toBe(projectA);
    expect(sessionsB[0].project_path).toBe(projectB);

    // Verify entries are isolated
    const entriesA = db.getEntries(sA);
    const entriesB = db.getEntries(sB);
    expect(entriesA.length).toBe(2);
    expect(entriesB.length).toBe(2);
    expect(entriesA[0].content).toBe("work on A");
    expect(entriesB[0].content).toBe("work on B");

    // Verify blockers are isolated
    const blockersA = db.getBlockers(projectA, false);
    const blockersB = db.getBlockers(projectB, false);
    expect(blockersA.length).toBe(1);
    expect(blockersB.length).toBe(0);

    // Open sessions are isolated
    const sA2 = db.createSession(projectA);
    const sB2 = db.createSession(projectB);
    expect(db.getOpenSession(projectA)!.id).toBe(sA2);
    expect(db.getOpenSession(projectB)!.id).toBe(sB2);
  });

  it("rolling pruning end-to-end: create 22 sessions, verify only 20 remain", () => {
    // Default max_sessions_per_project is 20
    const ids: number[] = [];
    for (let i = 0; i < 22; i++) {
      const id = db.createSession(project);
      db.addEntry(id, "attempt", `Work in session ${i}`, `Done ${i}`);
      db.closeSession(id, `Session ${i} summary`);
      ids.push(id);
    }

    const sessions = db.getRecentSessions(project, 100);
    expect(sessions.length).toBe(20);

    // The first 2 sessions should have been pruned
    const remainingIds = sessions.map(s => s.id);
    expect(remainingIds).not.toContain(ids[0]);
    expect(remainingIds).not.toContain(ids[1]);
    expect(remainingIds).toContain(ids[2]);
    expect(remainingIds).toContain(ids[21]);

    // Entries from pruned sessions should be gone
    expect(db.getEntries(ids[0])).toEqual([]);
    expect(db.getEntries(ids[1])).toEqual([]);

    // Entries from remaining sessions should still exist
    expect(db.getEntries(ids[2]).length).toBe(1);
    expect(db.getEntries(ids[21]).length).toBe(1);
  });

  it("empty session followed by a real session — empty one is discardable", () => {
    // Create an empty session
    const emptyId = db.createSession(project);
    db.closeSession(emptyId);
    db.discardIfEmpty(emptyId);

    // The empty session should be gone
    const sessionsAfterDiscard = db.getRecentSessions(project, 10);
    expect(sessionsAfterDiscard.length).toBe(0);

    // Create a real session with entries
    const realId = db.createSession(project);
    db.addEntry(realId, "attempt", "Real work", "Done");
    db.closeSession(realId, "Real session");

    // Only the real session remains
    const sessions = db.getRecentSessions(project, 10);
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe(realId);
    expect(sessions[0].summary).toBe("Real session");
  });

  it("resolve a blocker from a previous session in a new session", () => {
    // Session 1: log a blocker
    const s1 = db.createSession(project);
    const blockerId = db.addEntry(s1, "blocker", "CI is broken");
    db.addEntry(s1, "attempt", "tried fixing CI", "failed");
    db.closeSession(s1, "CI still broken");

    // Verify the blocker is unresolved
    const unresolved = db.getBlockers(project, false);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].id).toBe(blockerId);

    // Session 2: resolve the blocker from session 1
    const s2 = db.createSession(project);
    db.resolveBlocker(blockerId, "Updated Node version fixed CI");
    db.addEntry(s2, "attempt", "verified CI passes", "all green");
    db.closeSession(s2, "CI fixed");

    // Verify blocker is now resolved
    const resolved = db.getBlockers(project, true);
    expect(resolved.length).toBe(1);
    expect(resolved[0].id).toBe(blockerId);
    expect(resolved[0].outcome).toBe("Updated Node version fixed CI");

    const stillUnresolved = db.getBlockers(project, false);
    expect(stillUnresolved.length).toBe(0);
  });

  it("get_blockers returns blockers sorted correctly (by id ASC)", () => {
    const s1 = db.createSession(project);
    const b1 = db.addEntry(s1, "blocker", "First blocker");
    db.closeSession(s1);

    const s2 = db.createSession(project);
    const b2 = db.addEntry(s2, "blocker", "Second blocker");
    const b3 = db.addEntry(s2, "blocker", "Third blocker");

    const blockers = db.getBlockers(project, false);
    expect(blockers.length).toBe(3);
    expect(blockers[0].id).toBe(b1);
    expect(blockers[1].id).toBe(b2);
    expect(blockers[2].id).toBe(b3);
    expect(blockers[0].content).toBe("First blocker");
    expect(blockers[1].content).toBe("Second blocker");
    expect(blockers[2].content).toBe("Third blocker");
  });

  it("history with mixed session states (some closed with summary, some without)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));

    // Session 1: closed with summary
    const s1 = db.createSession(project);
    db.addEntry(s1, "attempt", "work 1", "done");
    db.closeSession(s1, "Completed task 1");

    // Session 2: closed without summary
    const s2 = db.createSession(project);
    db.addEntry(s2, "blocker", "stuck on deployment");
    db.closeSession(s2);

    // Session 3: still open (no ended_at)
    const s3 = db.createSession(project);
    db.addEntry(s3, "decision", "switch to Docker");

    const sessions = db.getRecentSessions(project, 10);
    const history = formatHistory(sessions.map(s => ({
      session: s,
      entries: db.getEntries(s.id),
    })));

    // All 3 sessions should appear
    expect(history).toContain("Session 1");
    expect(history).toContain("Session 2");
    expect(history).toContain("Session 3");

    // Session 1 (most recent, id=s3) should have no summary in output
    // Session 3 in the output (s1 by id) should have the summary
    // Note: sessions are returned most-recent-first
    expect(history).toContain("Summary: Completed task 1");

    // Session 2 had no summary, so "Summary:" should only appear once for the one with summary
    const summaryCount = (history.match(/Summary:/g) || []).length;
    expect(summaryCount).toBe(1);

    vi.useRealTimers();
  });

  it("formatting entries through the full pipeline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));

    const s = db.createSession(project);
    db.addEntry(s, "attempt", "tried migration", "partial success");
    db.addEntry(s, "blocker", "missing API key");
    db.addEntry(s, "decision", "use env vars for secrets");
    db.closeSession(s, "setup complete");

    const sessions = db.getRecentSessions(project, 1);
    const entries = db.getEntries(sessions[0].id);

    // Format each entry individually
    const formatted = entries.map(e => formatEntry(e));
    expect(formatted[0]).toBe("- Attempted: tried migration → partial success");
    expect(formatted[1]).toBe("- Blocker (unresolved): missing API key");
    expect(formatted[2]).toBe("- Decision: use env vars for secrets");

    // Format as handoff
    const handoff = formatHandoff(sessions[0], entries);
    expect(handoff).toContain("3 entries");
    expect(handoff).toContain("Summary: setup complete");

    vi.useRealTimers();
  });

  it("concurrent sessions for different projects don't interfere", () => {
    const pA = "/test/alpha";
    const pB = "/test/beta";
    const pC = "/test/gamma";

    // Create sessions for all 3 projects simultaneously
    const sA = db.createSession(pA);
    const sB = db.createSession(pB);
    const sC = db.createSession(pC);

    // Add entries to each
    db.addEntry(sA, "attempt", "alpha work");
    db.addEntry(sB, "blocker", "beta stuck");
    db.addEntry(sC, "decision", "gamma choice");

    // Verify each project sees only its own open session
    expect(db.getOpenSession(pA)!.id).toBe(sA);
    expect(db.getOpenSession(pB)!.id).toBe(sB);
    expect(db.getOpenSession(pC)!.id).toBe(sC);

    // Close project A, others should still be open
    db.closeSession(sA, "alpha done");
    expect(db.getOpenSession(pA)).toBeNull();
    expect(db.getOpenSession(pB)).not.toBeNull();
    expect(db.getOpenSession(pC)).not.toBeNull();

    // Entries don't cross projects
    expect(db.getEntries(sA).length).toBe(1);
    expect(db.getEntries(sB).length).toBe(1);
    expect(db.getEntries(sC).length).toBe(1);
  });

  it("pruning for one project does not affect another project", () => {
    db.setConfig("max_sessions_per_project", "2");

    const pA = "/test/pruning-a";
    const pB = "/test/pruning-b";

    // Create 3 sessions for project A (will trigger pruning on 3rd)
    for (let i = 0; i < 3; i++) {
      const id = db.createSession(pA);
      db.addEntry(id, "attempt", `A-${i}`);
      db.closeSession(id);
    }

    // Create 1 session for project B
    const bId = db.createSession(pB);
    db.addEntry(bId, "attempt", "B-0");
    db.closeSession(bId);

    // Project A should have 2 sessions (pruned to limit)
    const sessionsA = db.getRecentSessions(pA, 100);
    expect(sessionsA.length).toBe(2);

    // Project B should still have its 1 session untouched
    const sessionsB = db.getRecentSessions(pB, 100);
    expect(sessionsB.length).toBe(1);
    expect(db.getEntries(bId).length).toBe(1);
  });

  it("database persists across MemoirDB instances", () => {
    // Create data with first instance
    const s = db.createSession(project);
    db.addEntry(s, "attempt", "persisted work", "done");
    db.closeSession(s, "test persistence");
    db.close();

    // Open a new instance with the same path
    const db2 = new MemoirDB(dbPath);
    const sessions = db2.getRecentSessions(project, 10);
    expect(sessions.length).toBe(1);
    expect(sessions[0].summary).toBe("test persistence");

    const entries = db2.getEntries(sessions[0].id);
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe("persisted work");

    db2.close();
    // Prevent afterEach from double-closing
    db = new MemoirDB(tmpDbPath());
  });

  it("max entries limit prevents overfilling a session", () => {
    const s = db.createSession(project);
    for (let i = 0; i < 50; i++) {
      db.addEntry(s, "attempt", `Entry ${i}`);
    }

    // 51st entry should fail
    expect(() => db.addEntry(s, "attempt", "overflow")).toThrow(/maximum of 50/);

    // Session should still be functional
    const entries = db.getEntries(s);
    expect(entries.length).toBe(50);

    // Can still close the session
    db.closeSession(s, "full session");
    const sessions = db.getRecentSessions(project, 1);
    expect(sessions[0].summary).toBe("full session");
  });
});
