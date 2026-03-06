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
