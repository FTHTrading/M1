/**
 * Aggregated evidence collector — runs all collectors in parallel and
 * returns a unified CollectedEvidence object.
 */

import type { CollectedEvidence } from "../types.js";
import { collectSchemaEvidence } from "./schema-collector.js";
import { collectRouteFiles } from "./routes-collector.js";
import { collectPackageEvidence } from "./package-collector.js";
import { collectDocFiles } from "./docs-collector.js";

export async function collectAllEvidence(repoRoot: string): Promise<CollectedEvidence> {
  const [schema, routeFiles, packageEvidence, docFiles] = await Promise.all([
    collectSchemaEvidence(repoRoot),
    collectRouteFiles(repoRoot),
    collectPackageEvidence(repoRoot),
    collectDocFiles(repoRoot),
  ]);

  return {
    prismaModels: schema.models,
    prismaEnums: schema.enums,
    apiRouteFiles: routeFiles,
    packageDirs: packageEvidence.packageDirs,
    docFiles,
    workerJobFiles: packageEvidence.workerJobFiles,
  };
}
