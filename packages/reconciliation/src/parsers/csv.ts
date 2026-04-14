/**
 * CSV Bank Statement Parser
 *
 * Parses CSV bank statement exports into normalised StatementTransaction records.
 * Supports common US bank CSV layouts:
 *   - Standard (Date, Description, Amount, Balance) — e.g. Chase, BofA, Wells Fargo
 *   - Debit/Credit split (Date, Description, Debit, Credit, Balance) — e.g. Citi
 *   - ISO (Date, ValueDate, TransactionCode, Description, Amount, Balance) — e.g. Comerica
 *
 * Usage:
 *   const parser = new CsvStatementParser({ layout: "standard" });
 *   const result = parser.parse(csvString);
 */

export type CsvLayout = "standard" | "debit_credit" | "iso";

export interface StatementTransaction {
  /** Transaction date (settlement date) */
  date: Date;
  /** Bank-provided description / memo */
  description: string;
  /** Positive = credit, negative = debit (in minor currency units — cents) */
  amountCents: bigint;
  /** Running balance after transaction (cents) */
  balanceCents: bigint | null;
  /** Bank-assigned reference number, if present */
  reference: string | null;
  /** Raw row for debugging */
  rawRow: string;
}

export interface ParseResult {
  transactions: StatementTransaction[];
  parseErrors: Array<{ row: number; raw: string; error: string }>;
  currency: string;
  accountRef: string | null;
}

export interface CsvStatementParserConfig {
  layout?: CsvLayout;
  /** Override expected currency code (default: "USD") */
  currency?: string;
  /** Date format hint: "MM/DD/YYYY" | "YYYY-MM-DD" | "DD/MM/YYYY" (default: auto-detect) */
  dateFormat?: "MM/DD/YYYY" | "YYYY-MM-DD" | "DD/MM/YYYY";
  /** Column name overrides — use when bank CSV headers differ from defaults */
  columnMap?: Partial<{
    date: string;
    description: string;
    amount: string;
    debit: string;
    credit: string;
    balance: string;
    reference: string;
  }>;
}

const DEFAULT_COLS: Record<CsvLayout, Record<string, string>> = {
  standard: {
    date: "date",
    description: "description",
    amount: "amount",
    balance: "balance",
    reference: "reference",
  },
  debit_credit: {
    date: "date",
    description: "description",
    debit: "debit",
    credit: "credit",
    balance: "balance",
    reference: "check number",
  },
  iso: {
    date: "transaction date",
    description: "description",
    amount: "amount",
    balance: "balance",
    reference: "transaction id",
  },
};

export class CsvStatementParser {
  private readonly layout:     CsvLayout;
  private readonly currency:   string;
  private readonly dateFormat: string | undefined;
  private readonly columnMap:  Record<string, string>;

  constructor(config: CsvStatementParserConfig = {}) {
    this.layout     = config.layout ?? "standard";
    this.currency   = config.currency ?? "USD";
    this.dateFormat = config.dateFormat;
    this.columnMap  = { ...DEFAULT_COLS[this.layout], ...config.columnMap };
  }

  parse(csvText: string): ParseResult {
    const lines = csvText
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      return { transactions: [], parseErrors: [], currency: this.currency, accountRef: null };
    }

    const headerLine = lines[0]!;
    const headers    = this.splitCsv(headerLine).map((h) => h.toLowerCase().trim());

    const accountRef = this.extractAccountRef(lines);
    const transactions: StatementTransaction[] = [];
    const parseErrors: Array<{ row: number; raw: string; error: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i]!;
      try {
        const cols = this.splitCsv(raw);
        if (cols.length !== headers.length) continue; // skip summary rows

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });

        const tx = this.parseRow(row, raw);
        if (tx) transactions.push(tx);
      } catch (err: unknown) {
        parseErrors.push({ row: i + 1, raw, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { transactions, parseErrors, currency: this.currency, accountRef };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private parseRow(row: Record<string, string>, raw: string): StatementTransaction | null {
    const dateStr   = row[this.columnMap["date"] ?? "date"] ?? "";
    const descStr   = row[this.columnMap["description"] ?? "description"] ?? "";
    const balStr    = row[this.columnMap["balance"] ?? "balance"] ?? "";
    const refStr    = row[this.columnMap["reference"] ?? "reference"] ?? "";

    if (!dateStr && !descStr) return null;

    const date        = this.parseDate(dateStr);
    const balanceCents = balStr ? this.parseCurrencyToCents(balStr) : null;
    const reference   = refStr.trim() || null;

    let amountCents: bigint;

    if (this.layout === "debit_credit") {
      const debitStr  = row[this.columnMap["debit"]  ?? "debit"]  ?? "";
      const creditStr = row[this.columnMap["credit"] ?? "credit"] ?? "";
      const debit     = debitStr  ? this.parseCurrencyToCents(debitStr)  : 0n;
      const credit    = creditStr ? this.parseCurrencyToCents(creditStr) : 0n;
      amountCents = credit - debit;
    } else {
      const amtStr = row[this.columnMap["amount"] ?? "amount"] ?? "";
      amountCents  = this.parseCurrencyToCents(amtStr);
    }

    return { date, description: descStr.trim(), amountCents, balanceCents, reference, rawRow: raw };
  }

  private parseDate(raw: string): Date {
    const s = raw.trim().replace(/['"]/g, "");

    if (!s) throw new Error("Empty date value");

    // Auto-detect or use hint
    const fmt = this.dateFormat;

    if (!fmt || fmt === "YYYY-MM-DD") {
      // ISO 8601 variants: 2024-01-15, 2024/01/15
      const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (iso) {
        const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
        if (!isNaN(d.getTime())) return d;
      }
    }

    if (!fmt || fmt === "MM/DD/YYYY") {
      // US format: 01/15/2024, 1/15/2024
      const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (us) {
        const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
        const d    = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
        if (!isNaN(d.getTime())) return d;
      }
    }

    if (!fmt || fmt === "DD/MM/YYYY") {
      // European format: 15/01/2024
      const eu = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (eu) {
        const year = eu[3]!.length === 2 ? 2000 + Number(eu[3]) : Number(eu[3]);
        const d    = new Date(Date.UTC(year, Number(eu[2]) - 1, Number(eu[1])));
        if (!isNaN(d.getTime())) return d;
      }
    }

    // Fallback: native Date.parse
    const fallback = new Date(s);
    if (!isNaN(fallback.getTime())) return fallback;

    throw new Error(`Unparseable date: "${s}"`);
  }

  private parseCurrencyToCents(raw: string): bigint {
    const s = raw.trim().replace(/['"$€£,\s]/g, "");
    if (!s || s === "-") return 0n;

    const negative = s.startsWith("-") || s.startsWith("(");
    const clean    = s.replace(/[()+-]/g, "");

    const dotIdx = clean.lastIndexOf(".");
    let intPart: string;
    let fracPart: string;

    if (dotIdx === -1) {
      intPart  = clean;
      fracPart = "00";
    } else {
      intPart  = clean.slice(0, dotIdx);
      fracPart = clean.slice(dotIdx + 1).padEnd(2, "0").slice(0, 2);
    }

    const cents = BigInt(intPart || "0") * 100n + BigInt(fracPart);
    return negative ? -cents : cents;
  }

  private splitCsv(line: string): string[] {
    const result: string[] = [];
    let current   = "";
    let inQuotes  = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  private extractAccountRef(lines: string[]): string | null {
    // Some banks prepend account info rows before the CSV header
    for (const line of lines.slice(0, 5)) {
      const m = line.match(/account[:\s#]+([A-Z0-9*-]{4,20})/i);
      if (m) return m[1] ?? null;
    }
    return null;
  }
}
