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
