/**
 * Routes collector — lists TypeScript files in the API routes directory.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function collectRouteFiles(repoRoot: string): Promise<string[]> {
  const routesDir = join(repoRoot, "apps", "api", "src", "routes");
  try {
    const files = await readdir(routesDir);
    // Return stems only (strip .ts extension)
    return files
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""));
  } catch {
    return [];
  }
}
