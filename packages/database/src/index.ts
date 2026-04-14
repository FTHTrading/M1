export { PrismaClient } from "@prisma/client";
export type {
  User,
  Role,
  Permission,
  Entity,
  BankAccount,
  TreasuryAccount,
  Wallet,
  WalletWhitelistEntry,
  Counterparty,
  ComplianceProfile,
  ComplianceCase,
  MintRequest,
  RedemptionRequest,
  StablecoinTransfer,
  ProviderInstruction,
  JournalEntry,
  JournalLine,
  LedgerAccount,
  Approval,
  EventLog,
  AuditLog,
  ReconciliationRun,
  ReconciliationBreak,
  StatementImport,
  WireEvent,
  ReportJob,
  EvidenceFile,
  WebhookDelivery,
} from "@prisma/client";

export {
  UserStatus,
  RoleName,
  EntityStatus,
  EntityType,
  BankAccountStatus,
  BankAccountType,
  TreasuryAccountStatus,
  WalletStatus,
  NetworkType,
  StablecoinAsset,
  CounterpartyType,
  CounterpartyStatus,
  KybStatus,
  KycStatus,
  SanctionsScreeningResult,
  MintRequestStatus,
  RedemptionRequestStatus,
  TransferStatus,
  ApprovalStatus,
  ApprovalDecision,
  ReconciliationStatus,
  ReconciliationBreakType,
  BreakStatus,
  ReportJobStatus,
  ReportType,
  WebhookDeliveryStatus,
  ComplianceCaseStatus,
  JournalEntryStatus,
} from "@prisma/client";

import { PrismaClient } from "@prisma/client";

let prismaInstance: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log:
        process.env["NODE_ENV"] === "development"
          ? ["query", "warn", "error"]
          : ["warn", "error"],
    });
  }
  return prismaInstance;
}
