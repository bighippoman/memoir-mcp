import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Session, Entry } from "../db.js";
import { formatHandoff, formatHistory } from "../format.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const session: Session = {
  id: 1,
  project_path: "/test",
  started_at: "2026-03-06 10:00:00",
  ended_at: "2026-03-06 12:00:00",
  summary: "worked on auth",
};

const entries: Entry[] = [
  {
    id: 1,
    session_id: 1,
    type: "attempt",
    content: "migrated auth to Clerk",
    outcome: "succeeded",
    resolved: 0,
    created_at: "2026-03-06 10:05:00",
  },
  {
    id: 2,
    session_id: 1,
    type: "attempt",
    content: "upgraded to Next 16",
    outcome: "failed, peer dep conflicts",
    resolved: 0,
    created_at: "2026-03-06 10:30:00",
  },
  {
    id: 3,
    session_id: 1,
    type: "blocker",
    content: "convex SDK doesn't support React 19",
    outcome: null,
    resolved: 0,
    created_at: "2026-03-06 11:00:00",
  },
  {
    id: 4,
    session_id: 1,
    type: "decision",
    content: "keeping Next 15 until convex ships update",
    outcome: null,
    resolved: 0,
    created_at: "2026-03-06 11:30:00",
  },
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe("formatHandoff", () => {
  beforeEach(() => {
    // Fix time to 2026-03-06 14:00:00 UTC (4h after session start, 2h after end)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a message when session is null", () => {
    const result = formatHandoff(null, []);
    expect(result).toBe("No previous session found for this project.");
  });

  it("formats all entry types correctly and shows entry count", () => {
    const result = formatHandoff(session, entries);

    // Header with time ago and entry count
    expect(result).toContain("Last session (2h ago, 4 entries):");

    // Summary
    expect(result).toContain("Summary: worked on auth");

    // Attempt entries with outcome
    expect(result).toContain(
      "- Attempted: migrated auth to Clerk → succeeded"
    );
    expect(result).toContain(
      "- Attempted: upgraded to Next 16 → failed, peer dep conflicts"
    );

    // Unresolved blocker
    expect(result).toContain(
      "- Blocker (unresolved): convex SDK doesn't support React 19"
    );

    // Decision
    expect(result).toContain(
      "- Decision: keeping Next 15 until convex ships update"
    );
  });

  it("formats a resolved blocker with resolution", () => {
    const resolvedBlocker: Entry = {
      id: 5,
      session_id: 1,
      type: "blocker",
      content: "API rate limit hit",
      outcome: "switched to batch endpoint",
      resolved: 1,
      created_at: "2026-03-06 11:00:00",
    };

    const result = formatHandoff(session, [resolvedBlocker]);
    expect(result).toContain(
      "- Blocker (resolved): API rate limit hit → switched to batch endpoint"
    );
  });

  it("omits summary line when session has no summary", () => {
    const noSummarySession: Session = {
      ...session,
      summary: null,
    };
    const result = formatHandoff(noSummarySession, entries);
    expect(result).not.toContain("Summary:");
  });

  it("shows minutes for recent sessions", () => {
    // Set time to 30 minutes after session end
    vi.setSystemTime(new Date("2026-03-06T12:30:00Z"));
    const result = formatHandoff(session, entries);
    expect(result).toContain("30m ago");
  });

  it("shows days for old sessions", () => {
    // Set time to 3 days after session end
    vi.setSystemTime(new Date("2026-03-09T12:00:00Z"));
    const result = formatHandoff(session, entries);
    expect(result).toContain("3d ago");
  });
});

describe("formatHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a message when sessions array is empty", () => {
    const result = formatHistory([]);
    expect(result).toBe("No session history found for this project.");
  });

  it("formats multiple sessions with headers", () => {
    const session2: Session = {
      id: 2,
      project_path: "/test",
      started_at: "2026-03-06 12:00:00",
      ended_at: "2026-03-06 13:00:00",
      summary: "fixed bugs",
    };
    const entries2: Entry[] = [
      {
        id: 5,
        session_id: 2,
        type: "attempt",
        content: "fixed login redirect",
        outcome: "succeeded",
        resolved: 0,
        created_at: "2026-03-06 12:15:00",
      },
    ];

    const result = formatHistory([
      { session, entries },
      { session: session2, entries: entries2 },
    ]);

    // Session headers
    expect(result).toContain("### Session 1 (2h ago, 4 entries)");
    expect(result).toContain("### Session 2 (1h ago, 1 entries)");

    // Summaries
    expect(result).toContain("Summary: worked on auth");
    expect(result).toContain("Summary: fixed bugs");

    // Entries from both sessions
    expect(result).toContain(
      "- Attempted: migrated auth to Clerk → succeeded"
    );
    expect(result).toContain(
      "- Attempted: fixed login redirect → succeeded"
    );
  });
});
