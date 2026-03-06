#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoirDB } from "./db.js";
import { detectProject } from "./project.js";
import { formatHandoff, formatHistory } from "./format.js";
import path from "path";
import os from "os";

function envInt(name: string): number | undefined {
  const val = process.env[name];
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

const DB_PATH = path.join(os.homedir(), ".memoir", "memoir.db");
const db = new MemoirDB(DB_PATH, {
  maxContentLength: envInt("MEMOIR_MAX_CONTENT"),
  maxOutcomeLength: envInt("MEMOIR_MAX_OUTCOME"),
  maxEntriesPerSession: envInt("MEMOIR_MAX_ENTRIES"),
  maxSessionsPerProject: envInt("MEMOIR_MAX_SESSIONS"),
});
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
      content: z.string().max(db.maxContentLength).describe("What was attempted"),
      outcome: z.string().max(db.maxOutcomeLength).optional().describe("What happened"),
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
      content: z.string().max(db.maxContentLength).describe("What's blocked and why"),
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
      resolution: z.string().max(db.maxOutcomeLength).describe("What fixed it"),
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
      content: z.string().max(db.maxContentLength).describe("What was decided and why"),
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
      summary: z.string().max(db.maxContentLength).optional().describe("High-level session summary"),
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

const transport = new StdioServerTransport();
await server.connect(transport);
