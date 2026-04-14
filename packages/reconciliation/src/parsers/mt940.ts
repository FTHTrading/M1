/**
 * SWIFT MT940 Bank Statement Parser
 *
 * Parses SWIFT MT940 Customer Account Statement messages into normalised
 * StatementTransaction records. MT940 is widely used for cross-border cash
 * management (correspondent banks, HSBC, Deutsche Bank, Standard Chartered).
 *
 * MT940 Structure (relevant tags):
 *   :20:  Transaction Reference Number
 *   :25:  Account Identifier
 *   :28C: Statement Reference / Sequence Number
 *   :60F: Opening Balance (Final)
 *   :60M: Opening Balance (Intermediate)
 *   :61:  Statement Line (transaction)
 *   :86:  Information To Account Owner (transaction detail continuation)
 *   :62F: Closing Balance (Final)
 *   :62M: Closing Balance (Intermediate)
 *
 * Reference: SWIFT MT940 Customer Statement Message specification (SR 2024)
 */

import type { ParseResult, StatementTransaction } from "./csv.js";

export interface Mt940ParserConfig {
  /** Override currency (default: auto-detected from :60F tag) */
  currency?: string;
}

export class Mt940StatementParser {
  private readonly currencyOverride: string | undefined;

  constructor(config: Mt940ParserConfig = {}) {
    this.currencyOverride = config.currency;
  }

  parse(mt940Text: string): ParseResult {
    const text = mt940Text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Split into individual MT940 messages (delimited by :20:)
    const messages = this.splitMessages(text);

    const transactions: StatementTransaction[] = [];
    const parseErrors: Array<{ row: number; raw: string; error: string }> = [];
    let accountRef:    string | null = null;
    let currency                     = this.currencyOverride ?? "USD";

    let txIndex = 0;
    for (const message of messages) {
      try {
        const tags = this.parseTags(message);

        // :25: Account Identification — "IBAN/AccountNumber" or just account number
        const accountTag = tags.get("25") ?? "";
        if (!accountRef) {
          const parts = accountTag.split("/");
          accountRef = parts[parts.length - 1]?.trim().slice(-10) ?? null;
        }

        // :60F: / :60M: Opening balance — extract currency
        const openingBalance = tags.get("60F") ?? tags.get("60M") ?? "";
        if (openingBalance.length >= 3) {
          currency = this.currencyOverride ?? openingBalance.slice(1, 4);
        }

        // :61: Statement lines — one per transaction
        const statementLines = tags.getAll("61");
        const detailLines    = tags.getAll("86");

        for (let i = 0; i < statementLines.length; i++) {
          const line61 = statementLines[i]!;
          const line86 = detailLines[i] ?? "";
          txIndex++;
          try {
            const tx = this.parseStatementLine(line61, line86, txIndex.toString());
            transactions.push(tx);
          } catch (err: unknown) {
            parseErrors.push({
              row:   txIndex,
              raw:   line61,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err: unknown) {
        parseErrors.push({
          row:   txIndex,
          raw:   message.slice(0, 100),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { transactions, parseErrors, currency, accountRef };
  }

  // ── private helpers ──────────────────────────────────────────────────────

  /**
   * Split a multi-message MT940 file into individual messages.
   * Messages are delimited by :20: transaction reference lines.
   */
  private splitMessages(text: string): string[] {
    const parts    = text.split(/(?=^:20:)/m);
    return parts.map((p) => p.trim()).filter((p) => p.startsWith(":20:") || p.includes(":61:"));
  }

  /**
   * Parse SWIFT MT940 tags into a map.
   * Tags follow the pattern ":NN:" or ":NNC:" on a new line.
   * A MultiMap is simulated via getAll() for tags that may repeat (:61:, :86:).
   */
  private parseTags(message: string): { get(tag: string): string | undefined; getAll(tag: string): string[] } {
    const tagMap = new Map<string, string[]>();
    const tagRe  = /:(\d{2}[A-Z]?):([\s\S]*?)(?=:\d{2}[A-Z]?:|$)/g;

    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(message)) !== null) {
      const key   = match[1]!;
      const value = match[2]!.trim();
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key)!.push(value);
    }

    return {
      get:    (tag) => tagMap.get(tag)?.[0],
      getAll: (tag) => tagMap.get(tag) ?? [],
    };
  }

  /**
   * Parse a :61: statement line.
   *
   * Format: YYMMDD[MMDD]DC[S]Amount[N][Ref][//BankRef][\nDetails]
   *   YYMMDD   — Value date
   *   MMDD     — Optional entry date
   *   D/C      — Debit (D) or Credit (C) indicator; RD/RC = reversal
   *   S        — Optional swift transaction type identifier
   *   Amount   — Amount with comma as decimal separator (e.g. 1234,56)
   *   N        — Funds type
   *   Ref      — Customer reference (up to 16 chars)
   *   //BankRef — Bank reference (after //)
   */
  private parseStatementLine(
    line61: string,
    line86: string,
    fallbackRef: string,
  ): StatementTransaction {
    const raw = line61;

    // Extract value date (YYMMDD)
    const dateMatch = line61.match(/^(\d{6})(\d{4})?/);
    if (!dateMatch) throw new Error(`MT940 :61: missing date: "${line61.slice(0, 40)}"`);

    const valueDateStr = dateMatch[1]!;
    const date         = this.parseMt940Date(valueDateStr);

    // Strip date and optional entry date
    let rest = line61.slice(dateMatch[0].length);

    // DC indicator: C, D, CR, DR, RD, RC (reversal debit/credit)
    const dcMatch = rest.match(/^(R?[CD])/);
    if (!dcMatch) throw new Error(`MT940 :61: missing D/C indicator`);

    const dcIndicator = dcMatch[1]!;
    const isCredit    = dcIndicator.endsWith("C");
    const isReversal  = dcIndicator.startsWith("R");
    rest = rest.slice(dcIndicator.length);

    // Optional swift transaction type (single letter)
    if (/^[A-Z]/.test(rest) && !/^\d/.test(rest)) {
      rest = rest.slice(1);
    }

    // Amount: digits with comma as decimal separator
    const amtMatch = rest.match(/^([\d,]+)/);
    if (!amtMatch) throw new Error(`MT940 :61: missing amount`);
    const amtStr     = amtMatch[1]!.replace(",", ".");
    const amtDecimal = parseFloat(amtStr);
    if (isNaN(amtDecimal)) throw new Error(`MT940 :61: invalid amount "${amtMatch[1]}"`);

    const amountCents = BigInt(Math.round(amtDecimal * 100));
    const signed      = isCredit ? amountCents : -amountCents;
    const finalAmount = isReversal ? -signed : signed;

    rest = rest.slice(amtMatch[0].length);

    // Extract customer reference and optional bank reference
    const refParts    = rest.split("//");
    const custRef     = refParts[0]?.trim().slice(0, 16) || fallbackRef;
    const bankRef     = refParts[1]?.split("\n")[0]?.trim() ?? null;

    // :86: line provides human-readable description
    const description = this.parseDetailLine(line86) || `MT940 ${isCredit ? "CR" : "DR"}`;

    return {
      date,
      description,
      amountCents:  finalAmount,
      balanceCents: null,
      reference:    bankRef ?? custRef,
      rawRow:       raw,
    };
  }

  private parseDetailLine(line86: string): string {
    if (!line86) return "";
    // :86: may have sub-field codes like ?20, ?21, ?22 (Deutsche Bank format)
    const cleaned  = line86.replace(/\?\d{2}/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.slice(0, 250);
  }

  private parseMt940Date(raw: string): Date {
    // YYMMDD → interpret YY as 2000+YY if YY <= 99
    const year  = 2000 + Number(raw.slice(0, 2));
    const month = Number(raw.slice(2, 4)) - 1;
    const day   = Number(raw.slice(4, 6));
    const d     = new Date(Date.UTC(year, month, day));
    if (isNaN(d.getTime())) throw new Error(`Invalid MT940 date: "${raw}"`);
    return d;
  }
}
