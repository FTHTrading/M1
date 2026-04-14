/**
 * Schema collector — reads the Prisma schema file and extracts model and
 * enum names present in the codebase.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SchemaEvidence {
  models: string[];
  enums: string[];
}

export async function collectSchemaEvidence(repoRoot: string): Promise<SchemaEvidence> {
  const schemaPath = join(
    repoRoot,
    "packages",
    "database",
    "prisma",
    "schema.prisma",
  );

  let content: string;
  try {
    content = await readFile(schemaPath, "utf-8");
  } catch {
    return { models: [], enums: [] };
  }

  const models: string[] = [];
  const enums: string[] = [];

  for (const line of content.split("\n")) {
    const modelMatch = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelMatch?.[1]) {
      models.push(modelMatch[1]);
    }
    const enumMatch = /^enum\s+(\w+)\s*\{/.exec(line);
    if (enumMatch?.[1]) {
      enums.push(enumMatch[1]);
    }
  }

  return { models, enums };
}
