import { execFileSync } from "node:child_process";

/**
 * Detect the project root by finding the git repository root.
 * Returns "_default" if cwd is undefined or not inside a git repo.
 */
export function detectProject(cwd: string | undefined): string {
  if (cwd === undefined) {
    return "_default";
  }

  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    return root.trim();
  } catch {
    return "_default";
  }
}
