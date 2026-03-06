import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { detectProject } from "../project.js";

describe("detectProject", () => {
  it("finds git root from a subdirectory", () => {
    // process.cwd() is inside the memoir-mcp git repo
    const result = detectProject(process.cwd());
    // Should return an absolute path (the git root), not "_default"
    expect(result).not.toBe("_default");
    expect(result).toMatch(/^\//); // absolute path on unix
    // Running from a subdirectory should still find the repo root
    const fromSub = detectProject(process.cwd() + "/src");
    expect(fromSub).toBe(result);
  });

  it("returns '_default' for a non-git directory", () => {
    const result = detectProject(tmpdir());
    expect(result).toBe("_default");
  });

  it("returns '_default' for undefined input", () => {
    const result = detectProject(undefined);
    expect(result).toBe("_default");
  });
});
