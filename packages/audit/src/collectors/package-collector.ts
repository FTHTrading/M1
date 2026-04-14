/**
 * Package collector — lists sub-directories in the packages/ directory
 * and worker job file stems.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PackageEvidence {
  packageDirs: string[];
  workerJobFiles: string[];
}

export async function collectPackageEvidence(repoRoot: string): Promise<PackageEvidence> {
  const packageDirs: string[] = [];
  const workerJobFiles: string[] = [];

  // Scan packages/ for directories (sub-packages)
  const packagesDir = join(repoRoot, "packages");
  try {
    const entries = await readdir(packagesDir);
    for (const entry of entries) {
      const entryPath = join(packagesDir, entry);
      const s = await stat(entryPath).catch(() => null);
      if (s?.isDirectory()) packageDirs.push(entry);
    }
  } catch {
    // packages dir not found — handled gracefully
  }

  // Scan worker jobs/
  const jobsDir = join(repoRoot, "apps", "worker", "src", "jobs");
  try {
    const files = await readdir(jobsDir);
    for (const f of files) {
      if (f.endsWith(".ts")) workerJobFiles.push(f.replace(/\.ts$/, ""));
    }
  } catch {
    // no jobs dir
  }

  return { packageDirs, workerJobFiles };
}
