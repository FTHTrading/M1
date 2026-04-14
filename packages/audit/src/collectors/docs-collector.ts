/**
 * Docs collector — lists markdown files in the docs/ directories of both
 * the monorepo and the M1 platform docs repo.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function collectDocFiles(repoRoot: string): Promise<string[]> {
  const docFiles: string[] = [];

  const dirsToScan = [
    join(repoRoot, "docs"),
    // M1 repo docs — co-located if running from workspace root
    join(repoRoot, "..", "M1", "docs"),
  ];

  for (const dir of dirsToScan) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.endsWith(".md")) docFiles.push(f.replace(/\.md$/, ""));
      }
    } catch {
      // directory not found — skip
    }
  }

  return docFiles;
}
