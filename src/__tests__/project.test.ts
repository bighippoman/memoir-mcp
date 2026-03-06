import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
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

  it("returns '_default' for empty string", () => {
    const result = detectProject("");
    expect(result).toBe("_default");
  });

  it("finds git root from a deep subdirectory (src/__tests__/)", () => {
    const deepPath = path.join(process.cwd(), "src", "__tests__");
    const result = detectProject(deepPath);
    // Should find the same root as from the project root
    const rootResult = detectProject(process.cwd());
    expect(result).toBe(rootResult);
    expect(result).not.toBe("_default");
  });

  it("returned path is an absolute path", () => {
    const result = detectProject(process.cwd());
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("returns '_default' for a nonexistent directory", () => {
    const result = detectProject("/nonexistent/path/that/does/not/exist");
    expect(result).toBe("_default");
  });

  it("returns consistent results across multiple calls", () => {
    const result1 = detectProject(process.cwd());
    const result2 = detectProject(process.cwd());
    expect(result1).toBe(result2);
  });

  it("returns the repo root, not the given subdirectory", () => {
    const result = detectProject(path.join(process.cwd(), "src"));
    // Should not end with /src
    expect(result).not.toMatch(/\/src$/);
    // But should be a prefix of the subdirectory path
    expect(path.join(process.cwd(), "src").startsWith(result)).toBe(true);
  });
});
