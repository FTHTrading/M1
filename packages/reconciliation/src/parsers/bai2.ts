/**
 * BAI2 Bank Statement Parser
 *
 * Implements ANSI/BAF Cash Management Balance Reporting Specification
 * Version 2 (BAI2) — the industry standard format for corporate banking
 * statements delivered by US correspondent banks (JPMorgan, Citi, etc.)
 *
 * BAI2 Record Types:
 *   01 — File Header
 *   02 — Group Header
 *   03 — Account Identifier
 *   16 — Transaction Detail
 *   49 — Account Trailer
 *   88 — Continuation Record
 *   98 — Group Trailer
 *   99 — File Trailer
 *
 * Reference: Cash Management Balance Reporting BAI Version 2 User's Guide
 */

import type { ParseResult, StatementTransaction } from "./csv.js";

export interface Bai2ParserConfig {
  /** Override currency (default: "USD") */
  currency?: string;
}

/** BAI2 Type Code → description mapping (partial — common codes) */
const BAI2_TYPE_CODES: Record<string, string> = {
  "399": "Miscellaneous Credit",
  "455": "Wire Transfer",
  "475": "ACH Transfer",
  "495": "ZBA Credit",
  "169": "Miscellaneous Debit",
  "699": "Miscellaneous",
  "100": "Opening Ledger Balance",
  "400": "Opening Ledger Balance",
  "010": "Opening Available Balance",
  "015": "Opening Available Balance Alt",
  "040": "Closing Available Balance",
  "045": "Closing Ledger Balance",
  "050": "Closing Float",
  "072": "Total Credits",
  "074": "Total Debits",
};

interface Bai2Account {
  accountId:   string;
  currency:    string;
  transactions: StatementTransaction[];
}

export class Bai2StatementParser {
  private readonly currency: string;

  constructor(config: Bai2ParserConfig = {}) {
    this.currency = config.currency ?? "USD";
  }

  parse(bai2Text: string): ParseResult {
    const lines = bai2Text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const expandedLines = this.expandContinuationRecords(lines);

    const transactions: StatementTransaction[] = [];
    const parseErrors: Array<{ row: number; raw: string; error: string }> = [];

    let accountRef: string | null = null;
    let fileDate: string | null   = null;
    let pendingTx: Partial<StatementTransaction> | null = null;

    for (let i = 0; i < expandedLines.length; i++) {
      const raw    = expandedLines[i]!;
      const fields = raw.split(",");
      const code   = fields[0]?.trim();

      try {
        switch (code) {
          case "01": // File Header
            fileDate = fields[3]?.trim() ?? null;
            break;

          case "03": { // Account Identifier
            accountRef = fields[1]?.trim() ?? null;
            break;
          }

          case "16": { // Transaction Detail
            if (pendingTx?.description !== undefined) {
              // flush previous
              const completed = this.completeTx(pendingTx, fileDate);
              if (completed) transactions.push(completed);
            }
            pendingTx = this.parseTransactionRecord(fields, fileDate, raw);
            break;
          }

          case "49": // Account Trailer
          case "98": // Group Trailer
          case "99": // File Trailer
            if (pendingTx) {
              const completed = this.completeTx(pendingTx, fileDate);
              if (completed) transactions.push(completed);
              pendingTx = null;
            }
            break;
        }
      } catch (err: unknown) {
        parseErrors.push({
          row:   i + 1,
          raw,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      transactions,
      parseErrors,
      currency:   this.currency,
      accountRef,
    };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  /**
   * BAI2 continuation records (type 88) append text to the previous record.
   * Merge them before parsing.
   */
  private expandContinuationRecords(lines: string[]): string[] {
    const result: string[] = [];
    for (const line of lines) {
      if (line.startsWith("88,")) {
        // Append continuation payload to last result line
        const last = result[result.length - 1];
        if (last !== undefined) {
          result[result.length - 1] = `${last}${line.slice(3)}`;
        }
      } else {
        result.push(line);
      }
    }
    return result;
  }

  private parseTransactionRecord(
    fields: string[],
    fileDate: string | null,
    raw: string,
  ): Partial<StatementTransaction> {
    // 16,TypeCode,Amount,FundsType,[Date],[Ref],[Text]
    const typeCode  = fields[1]?.trim() ?? "";
    const amtStr    = fields[2]?.trim() ?? "0";
    const fundsType = fields[3]?.trim() ?? "";

    // Amount in cents (BAI2 amounts are in cents — no decimal point)
    const rawAmt = amtStr.replace(/[^0-9-]/g, "");
    const amountCents = rawAmt ? BigInt(rawAmt) : 0n;

    // Date from record (field 4 or 5 depending on FundsType flags)
    let dateStr = fileDate ?? "";
    let refStart = 4;
    if (["S", "V", "0", "1", "2", "Z", "D"].includes(fundsType)) {
      dateStr  = fields[4]?.trim() ?? dateStr;
      refStart = 5;
    }

    const reference  = fields[refStart]?.trim()     || null;
    const text       = fields.slice(refStart + 1).join(",").trim();
    const description = text || (BAI2_TYPE_CODES[typeCode] ?? `TX-${typeCode}`);

    return {
      date:         this.parseBai2Date(dateStr),
      description,
      amountCents,
      balanceCents: null,
      reference,
      rawRow:       raw,
    };
  }

  private completeTx(partial: Partial<StatementTransaction>, _fileDate: string | null): StatementTransaction | null {
    if (!partial.date || partial.amountCents === undefined) return null;
    return {
      date:         partial.date,
      description:  partial.description ?? "",
      amountCents:  partial.amountCents,
      balanceCents: partial.balanceCents ?? null,
      reference:    partial.reference ?? null,
      rawRow:       partial.rawRow ?? "",
    };
  }

  private parseBai2Date(raw: string): Date {
    const s = raw.trim();
    if (!s || s.length < 6) return new Date();

    // BAI2 date format: YYMMDD or YYYYMMDD
    if (s.length === 6) {
      const year  = 2000 + Number(s.slice(0, 2));
      const month = Number(s.slice(2, 4)) - 1;
      const day   = Number(s.slice(4, 6));
      return new Date(Date.UTC(year, month, day));
    }
    if (s.length === 8) {
      const year  = Number(s.slice(0, 4));
      const month = Number(s.slice(4, 6)) - 1;
      const day   = Number(s.slice(6, 8));
      return new Date(Date.UTC(year, month, day));
    }

    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? new Date() : fallback;
  }
}
