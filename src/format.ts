import type { Session, Entry } from "./db.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

export function timeAgo(dateStr: string): string {
  // Parse as UTC
  const then = new Date(dateStr + "Z").getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMs / 3_600_000);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffMs / 86_400_000);
  return `${diffDays}d ago`;
}

export function formatEntry(entry: Entry): string {
  switch (entry.type) {
    case "attempt":
      return `- Attempted: ${entry.content} → ${entry.outcome ?? "no outcome"}`;

    case "blocker":
      if (entry.resolved) {
        return `- Blocker (resolved): ${entry.content} → ${entry.outcome}`;
      }
      return `- Blocker (unresolved): ${entry.content}`;

    case "decision":
      return `- Decision: ${entry.content}`;

    default:
      return `- ${entry.type}: ${entry.content}`;
  }
}

// ── Formatters ──────────────────────────────────────────────────────────────

export function formatHandoff(
  session: Session | null,
  entries: Entry[]
): string {
  if (session === null) {
    return "No previous session found for this project.";
  }

  const ago = timeAgo(session.ended_at ?? session.started_at);
  const lines: string[] = [];

  lines.push(`Last session (${ago}, ${entries.length} entries):`);

  if (session.summary) {
    lines.push(`Summary: ${session.summary}`);
  }

  lines.push(""); // blank line before entries

  for (const entry of entries) {
    lines.push(formatEntry(entry));
  }

  return lines.join("\n");
}

export function formatHistory(
  sessions: Array<{ session: Session; entries: Entry[] }>
): string {
  if (sessions.length === 0) {
    return "No session history found for this project.";
  }

  const blocks: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const { session, entries } = sessions[i];
    const ago = timeAgo(session.ended_at ?? session.started_at);
    const lines: string[] = [];

    lines.push(
      `### Session ${i + 1} (${ago}, ${entries.length} entries)`
    );

    if (session.summary) {
      lines.push(`Summary: ${session.summary}`);
    }

    lines.push(""); // blank line before entries

    for (const entry of entries) {
      lines.push(formatEntry(entry));
    }

    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}
