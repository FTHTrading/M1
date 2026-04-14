/**
 * Bank Statement Parser — barrel export
 *
 * Usage:
 *   import { CsvStatementParser, Bai2StatementParser, Mt940StatementParser } from "@treasury/reconciliation/parsers";
 *   import type { StatementTransaction, ParseResult } from "@treasury/reconciliation/parsers";
 */

export { CsvStatementParser } from "./csv.js";
export type { CsvLayout, CsvStatementParserConfig, StatementTransaction, ParseResult } from "./csv.js";

export { Bai2StatementParser } from "./bai2.js";
export type { Bai2ParserConfig } from "./bai2.js";

export { Mt940StatementParser } from "./mt940.js";
export type { Mt940ParserConfig } from "./mt940.js";

/**
 * Auto-detect statement format and return the appropriate parser.
 * Inspects. the first ~512 bytes of text to identify format type.
 */
export function detectStatementFormat(text: string): "csv" | "bai2" | "mt940" | "unknown" {
  const sample = text.slice(0, 512).trim();

  // BAI2: starts with "01," record type code
  if (/^01,/.test(sample)) return "bai2";

  // MT940: starts with ":20:" tag
  if (/^:20:/.test(sample)) return "mt940";

  // CSV: first non-empty line contains comma-separated text headers
  const firstLine = sample.split(/\n/)[0] ?? "";
  if (firstLine.includes(",") && /[a-z]/i.test(firstLine)) return "csv";

  return "unknown";
}
