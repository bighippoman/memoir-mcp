import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Session, Entry } from "../db.js";
import { formatHandoff, formatHistory, formatEntry, timeAgo } from "../format.js";

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

// ── formatHandoff edge cases ─────────────────────────────────────────

describe("formatHandoff edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("session with no entries shows 0 entries", () => {
    const result = formatHandoff(session, []);
    expect(result).toContain("0 entries");
    expect(result).toContain("Last session");
    expect(result).toContain("Summary: worked on auth");
  });

  it("session with only attempts (no blockers/decisions)", () => {
    const attemptEntries: Entry[] = [
      {
        id: 1,
        session_id: 1,
        type: "attempt",
        content: "tried A",
        outcome: "worked",
        resolved: 0,
        created_at: "2026-03-06 10:05:00",
      },
      {
        id: 2,
        session_id: 1,
        type: "attempt",
        content: "tried B",
        outcome: "failed",
        resolved: 0,
        created_at: "2026-03-06 10:10:00",
      },
    ];

    const result = formatHandoff(session, attemptEntries);
    expect(result).toContain("- Attempted: tried A → worked");
    expect(result).toContain("- Attempted: tried B → failed");
    expect(result).not.toContain("Blocker");
    expect(result).not.toContain("Decision");
  });

  it("session with only blockers", () => {
    const blockerEntries: Entry[] = [
      {
        id: 1,
        session_id: 1,
        type: "blocker",
        content: "can't deploy",
        outcome: null,
        resolved: 0,
        created_at: "2026-03-06 10:05:00",
      },
    ];

    const result = formatHandoff(session, blockerEntries);
    expect(result).toContain("- Blocker (unresolved): can't deploy");
    expect(result).toContain("1 entries");
  });

  it("session with resolved blocker shows resolution", () => {
    const resolvedEntries: Entry[] = [
      {
        id: 1,
        session_id: 1,
        type: "blocker",
        content: "db migration failed",
        outcome: "rolled back and re-ran",
        resolved: 1,
        created_at: "2026-03-06 10:05:00",
      },
    ];

    const result = formatHandoff(session, resolvedEntries);
    expect(result).toContain(
      "- Blocker (resolved): db migration failed → rolled back and re-ran"
    );
  });

  it("session with no summary omits Summary line", () => {
    const noSummarySession: Session = {
      ...session,
      summary: null,
    };

    const result = formatHandoff(noSummarySession, entries);
    expect(result).not.toContain("Summary:");
    // But should still have header and entries
    expect(result).toContain("Last session");
    expect(result).toContain("4 entries");
  });

  it("attempt with no outcome shows 'no outcome'", () => {
    const noOutcomeEntries: Entry[] = [
      {
        id: 1,
        session_id: 1,
        type: "attempt",
        content: "tried something",
        outcome: null,
        resolved: 0,
        created_at: "2026-03-06 10:05:00",
      },
    ];

    const result = formatHandoff(session, noOutcomeEntries);
    expect(result).toContain("- Attempted: tried something → no outcome");
  });

  it("uses started_at when ended_at is null", () => {
    const openSession: Session = {
      id: 1,
      project_path: "/test",
      started_at: "2026-03-06 10:00:00",
      ended_at: null,
      summary: null,
    };

    const result = formatHandoff(openSession, []);
    // Time should be relative to started_at (4h ago)
    expect(result).toContain("4h ago");
  });
});

// ── formatHistory edge cases ─────────────────────────────────────────

describe("formatHistory edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("single session history", () => {
    const result = formatHistory([{ session, entries }]);
    expect(result).toContain("### Session 1");
    expect(result).toContain("4 entries");
    expect(result).toContain("Summary: worked on auth");
    // Should not contain Session 2
    expect(result).not.toContain("### Session 2");
  });

  it("many sessions (5+)", () => {
    const sessions = [];
    for (let i = 0; i < 6; i++) {
      sessions.push({
        session: {
          id: i + 1,
          project_path: "/test",
          started_at: "2026-03-06 10:00:00",
          ended_at: "2026-03-06 12:00:00",
          summary: `session ${i + 1}`,
        },
        entries: [
          {
            id: i * 10 + 1,
            session_id: i + 1,
            type: "attempt" as const,
            content: `entry for session ${i + 1}`,
            outcome: "done",
            resolved: 0,
            created_at: "2026-03-06 10:05:00",
          },
        ],
      });
    }

    const result = formatHistory(sessions);
    expect(result).toContain("### Session 1");
    expect(result).toContain("### Session 6");
    expect(result).toContain("Summary: session 1");
    expect(result).toContain("Summary: session 6");
  });

  it("sessions with varying entry counts", () => {
    const sessionWithMany: Entry[] = [];
    for (let i = 0; i < 5; i++) {
      sessionWithMany.push({
        id: i + 1,
        session_id: 1,
        type: "attempt",
        content: `entry ${i}`,
        outcome: "ok",
        resolved: 0,
        created_at: "2026-03-06 10:05:00",
      });
    }

    const result = formatHistory([
      { session, entries: sessionWithMany },
      {
        session: {
          ...session,
          id: 2,
          summary: "quick session",
        },
        entries: [],
      },
    ]);

    expect(result).toContain("5 entries");
    expect(result).toContain("0 entries");
  });

  it("sessions without summaries omit Summary line", () => {
    const noSummarySession: Session = {
      ...session,
      summary: null,
    };

    const result = formatHistory([
      { session: noSummarySession, entries },
    ]);

    expect(result).not.toContain("Summary:");
    expect(result).toContain("### Session 1");
  });

  it("sessions are separated by double newlines", () => {
    const session2: Session = {
      id: 2,
      project_path: "/test",
      started_at: "2026-03-06 12:00:00",
      ended_at: "2026-03-06 13:00:00",
      summary: "second",
    };

    const result = formatHistory([
      { session, entries: [] },
      { session: session2, entries: [] },
    ]);

    expect(result).toContain("\n\n");
  });
});

// ── formatEntry edge cases ───────────────────────────────────────────

describe("formatEntry edge cases", () => {
  it("attempt with outcome", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "attempt",
      content: "tried X",
      outcome: "success",
      resolved: 0,
      created_at: "2026-03-06 10:00:00",
    };
    expect(formatEntry(entry)).toBe("- Attempted: tried X → success");
  });

  it("attempt without outcome", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "attempt",
      content: "tried X",
      outcome: null,
      resolved: 0,
      created_at: "2026-03-06 10:00:00",
    };
    expect(formatEntry(entry)).toBe("- Attempted: tried X → no outcome");
  });

  it("unresolved blocker", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "blocker",
      content: "stuck on Z",
      outcome: null,
      resolved: 0,
      created_at: "2026-03-06 10:00:00",
    };
    expect(formatEntry(entry)).toBe("- Blocker (unresolved): stuck on Z");
  });

  it("resolved blocker with outcome", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "blocker",
      content: "stuck on Z",
      outcome: "fixed it",
      resolved: 1,
      created_at: "2026-03-06 10:00:00",
    };
    expect(formatEntry(entry)).toBe(
      "- Blocker (resolved): stuck on Z → fixed it"
    );
  });

  it("decision entry", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "decision",
      content: "use TypeScript",
      outcome: null,
      resolved: 0,
      created_at: "2026-03-06 10:00:00",
    };
    expect(formatEntry(entry)).toBe("- Decision: use TypeScript");
  });

  it("unknown entry type uses fallback format", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "unknown_custom" as string,
      content: "some content",
      outcome: null,
      resolved: 0,
      created_at: "2026-03-06 10:00:00",
    };
    expect(formatEntry(entry)).toBe("- unknown_custom: some content");
  });

  it("entry with very long content displays it all (truncation happens at DB level)", () => {
    const longContent = "x".repeat(500);
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "attempt",
      content: longContent,
      outcome: null,
      resolved: 0,
      created_at: "2026-03-06 10:00:00",
    };
    const result = formatEntry(entry);
    expect(result).toContain(longContent);
  });

  it("resolved blocker with null outcome shows null", () => {
    const entry: Entry = {
      id: 1,
      session_id: 1,
      type: "blocker",
      content: "stuck",
      outcome: null,
      resolved: 1,
      created_at: "2026-03-06 10:00:00",
    };
    // resolved=1 means it takes the resolved branch
    expect(formatEntry(entry)).toBe("- Blocker (resolved): stuck → null");
  });
});

// ── timeAgo edge cases ───────────────────────────────────────────────

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns minutes for less than 60 minutes", () => {
    expect(timeAgo("2026-03-06 13:45:00")).toBe("15m ago");
  });

  it("returns 0m for just now", () => {
    expect(timeAgo("2026-03-06 14:00:00")).toBe("0m ago");
  });

  it("returns hours for less than 24 hours", () => {
    expect(timeAgo("2026-03-06 08:00:00")).toBe("6h ago");
  });

  it("returns days for 24+ hours", () => {
    expect(timeAgo("2026-03-04 14:00:00")).toBe("2d ago");
  });

  it("returns 1d for exactly 24 hours", () => {
    expect(timeAgo("2026-03-05 14:00:00")).toBe("1d ago");
  });

  it("returns 59m for 59 minutes", () => {
    expect(timeAgo("2026-03-06 13:01:00")).toBe("59m ago");
  });
});
