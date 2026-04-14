import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Stablecoin Treasury OS...");

  // ── Roles ────────────────────────────────────────────────────────────────────
  const roleDefinitions = [
    { name: "super_admin" as const, displayName: "Super Administrator", description: "Full system access" },
    { name: "treasury_operator" as const, displayName: "Treasury Operator", description: "Initiates and processes treasury operations" },
    { name: "treasury_approver" as const, displayName: "Treasury Approver", description: "Reviews and approves treasury requests" },
    { name: "compliance_officer" as const, displayName: "Compliance Officer", description: "Manages compliance cases and KYC/KYB" },
    { name: "finance_controller" as const, displayName: "Finance Controller", description: "Manages ledger and reporting" },
    { name: "auditor" as const, displayName: "Auditor", description: "Read-only access to all audit logs" },
    { name: "read_only" as const, displayName: "Read Only", description: "Read-only access to dashboard" },
  ];

  const roles: Record<string, { id: string }> = {};
  for (const rd of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { name: rd.name },
      update: {},
      create: rd,
    });
    roles[rd.name] = role;
  }
  console.log("  ✓ Roles created");

  // ── Ledger Accounts ──────────────────────────────────────────────────────────
  const ledgerAccountDefs = [
    { code: "1001", name: "Fiat Cash — Operating", type: "ASSET", description: "Primary operating bank deposits" },
    { code: "1002", name: "Pending Fiat Settlement", type: "ASSET", description: "Fiat pending bank confirmation" },
    { code: "1101", name: "USDC Inventory", type: "ASSET", description: "USDC held in custody" },
    { code: "1102", name: "USDT Inventory", type: "ASSET", description: "USDT held in custody" },
    { code: "1201", name: "Receivables — Provider", type: "ASSET", description: "Amounts due from stablecoin providers" },
    { code: "1501", name: "Custodial Reserve", type: "ASSET", description: "Reserved collateral for custody operations" },
    { code: "2001", name: "Payables — Provider", type: "LIABILITY", description: "Amounts owed to stablecoin providers" },
    { code: "2101", name: "Client Obligations — USDC", type: "LIABILITY", description: "USDC owed to clients" },
    { code: "2102", name: "Client Obligations — USDT", type: "LIABILITY", description: "USDT owed to clients" },
    { code: "5001", name: "Fees Expense — Network", type: "EXPENSE", description: "On-chain network fees paid" },
    { code: "5002", name: "Fees Expense — Custody", type: "EXPENSE", description: "Custody provider fees" },
    { code: "5003", name: "Fees Expense — FX", type: "EXPENSE", description: "FX conversion costs" },
  ];

  for (const la of ledgerAccountDefs) {
    await prisma.ledgerAccount.upsert({
      where: { code: la.code },
      update: {},
      create: la,
    });
  }
  console.log("  ✓ Ledger accounts created");

  // ── Super Admin User ─────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@treasury.local" },
    update: {},
    create: {
      email: "admin@treasury.local",
      name: "System Administrator",
      passwordHash: hashSync("Admin1234!", 12),
      status: "ACTIVE",
      emailVerified: true,
    },
  });

  if (roles["super_admin"]) {
    await prisma.userRole.upsert({
      where: { userId_roleId_entityId: { userId: adminUser.id, roleId: roles["super_admin"].id, entityId: null } },
      update: {},
      create: { userId: adminUser.id, roleId: roles["super_admin"].id },
    });
  }

  const operatorUser = await prisma.user.upsert({
    where: { email: "operator@treasury.local" },
    update: {},
    create: {
      email: "operator@treasury.local",
      name: "Treasury Operator",
      passwordHash: hashSync("Operator1234!", 12),
      status: "ACTIVE",
      emailVerified: true,
    },
  });

  const approverUser = await prisma.user.upsert({
    where: { email: "approver@treasury.local" },
    update: {},
    create: {
      email: "approver@treasury.local",
      name: "Treasury Approver",
      passwordHash: hashSync("Approver1234!", 12),
      status: "ACTIVE",
      emailVerified: true,
    },
  });
  console.log("  ✓ Users created");

  // ── Entity ───────────────────────────────────────────────────────────────────
  const entity = await prisma.entity.upsert({
    where: { id: "seed-entity-001" },
    update: {},
    create: {
      id: "seed-entity-001",
      legalName: "Acme Treasury Corp",
      tradingName: "Acme Treasury",
      entityType: "CORPORATION",
      status: "ACTIVE",
      countryOfIncorporation: "US",
      registrationNumber: "12-3456789",
      taxId: "12-3456789",
      address: {
        street: "123 Financial Street",
        city: "New York",
        state: "NY",
        postalCode: "10005",
        country: "US",
      },
      contactEmail: "treasury@acme-example.com",
      contactPhone: "+1-212-555-0100",
    },
  });

  // assign roles on entity
  for (const [roleName, user] of [
    ["treasury_operator", operatorUser],
    ["treasury_approver", approverUser],
  ] as const) {
    const role = roles[roleName];
    if (!role) continue;
    await prisma.userRole.upsert({
      where: { userId_roleId_entityId: { userId: user.id, roleId: role.id, entityId: entity.id } },
      update: {},
      create: { userId: user.id, roleId: role.id, entityId: entity.id },
    });
  }
  console.log("  ✓ Entity created");

  // ── Compliance Profile ────────────────────────────────────────────────────────
  await prisma.complianceProfile.upsert({
    where: { entityId: entity.id },
    update: {},
    create: {
      entityId: entity.id,
      kybStatus: "APPROVED",
      kycStatus: "APPROVED",
      sanctionsResult: "CLEAR",
      sanctionsCheckedAt: new Date(),
      riskRating: "LOW",
      nextReviewAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
  console.log("  ✓ Compliance profile created");

  // ── Bank Account ──────────────────────────────────────────────────────────────
  const bankAccount = await prisma.bankAccount.upsert({
    where: { id: "seed-bank-001" },
    update: {},
    create: {
      id: "seed-bank-001",
      entityId: entity.id,
      accountName: "Acme Operating Account",
      bankName: "First National Bank",
      accountNumber: "****4321",
      routingNumber: "021000021",
      currency: "USD",
      accountType: "CHECKING",
      status: "ACTIVE",
      isVerified: true,
      verifiedAt: new Date(),
    },
  });
  console.log("  ✓ Bank account created");

  // ── Treasury Account ──────────────────────────────────────────────────────────
  const treasuryAccount = await prisma.treasuryAccount.upsert({
    where: { id: "seed-treasury-001" },
    update: {},
    create: {
      id: "seed-treasury-001",
      entityId: entity.id,
      bankAccountId: bankAccount.id,
      name: "Primary USD Treasury",
      description: "Primary operating treasury for USD → USDC conversions",
      status: "ACTIVE",
      fiatBalanceCents: 50_000_000_00n, // $5,000,000
      settledUsdcUnits: 1_000_000_000_000n, // 1,000,000 USDC (6 decimals)
    },
  });
  console.log("  ✓ Treasury account created");

  // ── Wallets ────────────────────────────────────────────────────────────────────
  await prisma.wallet.upsert({
    where: { network_address: { network: "ETHEREUM", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" } },
    update: {},
    create: {
      id: "seed-wallet-usdc-eth",
      entityId: entity.id,
      label: "Primary USDC — Ethereum",
      network: "ETHEREUM",
      asset: "USDC",
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      status: "ACTIVE",
      isWhitelisted: true,
      whitelistedAt: new Date(),
      notes: "Primary institutional USDC wallet on Ethereum",
    },
  });

  await prisma.wallet.upsert({
    where: { network_address: { network: "TRON", address: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9" } },
    update: {},
    create: {
      id: "seed-wallet-usdt-tron",
      entityId: entity.id,
      label: "Primary USDT — TRON",
      network: "TRON",
      asset: "USDT",
      address: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
      status: "ACTIVE",
      isWhitelisted: true,
      whitelistedAt: new Date(),
      notes: "Primary institutional USDT wallet on TRON",
    },
  });
  console.log("  ✓ Wallets created");

  // ── Counterparty (Circle) ─────────────────────────────────────────────────────
  const circleCounterparty = await prisma.counterparty.upsert({
    where: { id: "seed-counterparty-circle" },
    update: {},
    create: {
      id: "seed-counterparty-circle",
      name: "Circle Internet Financial, LLC",
      type: "CIRCLE",
      status: "ACTIVE",
      kybStatus: "APPROVED",
      sanctionsResult: "CLEAR",
      sanctionsCheckedAt: new Date(),
      contactEmail: "treasury@circle.com",
      notes: "Circle Mint institutional USDC provider",
    },
  });

  await prisma.counterparty.upsert({
    where: { id: "seed-counterparty-tether" },
    update: {},
    create: {
      id: "seed-counterparty-tether",
      name: "Tether Operations Limited",
      type: "TETHER_OTC",
      status: "ACTIVE",
      kybStatus: "APPROVED",
      sanctionsResult: "CLEAR",
      sanctionsCheckedAt: new Date(),
      contactEmail: "institutions@tether.to",
      referenceCode: "INSTITUTION-REF-PLACEHOLDER",
      notes: "Verified Tether institutional acquisition counterparty",
    },
  });
  console.log("  ✓ Counterparties created");

  // ── Sample Mint Request ───────────────────────────────────────────────────────
  await prisma.mintRequest.upsert({
    where: { id: "seed-mint-001" },
    update: {},
    create: {
      id: "seed-mint-001",
      entityId: entity.id,
      treasuryAccountId: treasuryAccount.id,
      initiatedById: operatorUser.id,
      counterpartyId: circleCounterparty.id,
      settlementWalletId: "seed-wallet-usdc-eth",
      asset: "USDC",
      requestedAmountCents: 1_000_000_00n, // $100,000 USD
      quotedUnits: 100_000_000_000n, // 100,000 USDC
      status: "PENDING_APPROVAL",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Sample redemption request
  await prisma.redemptionRequest.upsert({
    where: { id: "seed-redeem-001" },
    update: {},
    create: {
      id: "seed-redeem-001",
      entityId: entity.id,
      treasuryAccountId: treasuryAccount.id,
      initiatedById: operatorUser.id,
      counterpartyId: circleCounterparty.id,
      asset: "USDC",
      requestedUnits: 50_000_000_000n, // 50,000 USDC
      expectedFiatCents: 50_000_00n,   // $50,000
      status: "PENDING_APPROVAL",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  console.log("  ✓ Sample requests created");

  // ── Sample Reconciliation Break ───────────────────────────────────────────────
  const reconRun = await prisma.reconciliationRun.create({
    data: {
      runDate: new Date(),
      entityId: entity.id,
      status: "COMPLETED",
      bankBalanceCents: 50_000_000_00n,
      providerUsdcBalance: 1_000_000_000_000n,
      ledgerUsdcBalance: 999_000_000_000n,
      completedAt: new Date(),
      breakCount: 1,
    },
  });

  await prisma.reconciliationBreak.create({
    data: {
      reconciliationRunId: reconRun.id,
      breakType: "LEDGER_IMBALANCE",
      status: "OPEN",
      description: "Provider reports 1,000,000 USDC; ledger shows 999,000 USDC — 1,000 unit discrepancy",
      amountCents: 100_000n,
      expectedValue: "1000000.000000",
      actualValue:   "999000.000000",
      referenceType: "treasury_account",
      referenceId: treasuryAccount.id,
    },
  });
  console.log("  ✓ Sample reconciliation break created");

  // ── Seed Events ───────────────────────────────────────────────────────────────
  await prisma.eventLog.createMany({
    skipDuplicates: true,
    data: [
      {
        eventType: "entity.created",
        aggregateId: entity.id,
        aggregateType: "Entity",
        actorId: adminUser.id,
        actorType: "user",
        payload: { entityId: entity.id, name: entity.legalName },
      },
      {
        eventType: "mint_request.created",
        aggregateId: "seed-mint-001",
        aggregateType: "MintRequest",
        actorId: operatorUser.id,
        actorType: "user",
        payload: { mintRequestId: "seed-mint-001", amountCents: "10000000" },
      },
      {
        eventType: "redemption_request.created",
        aggregateId: "seed-redeem-001",
        aggregateType: "RedemptionRequest",
        actorId: operatorUser.id,
        actorType: "user",
        payload: { redemptionRequestId: "seed-redeem-001", units: "50000000000" },
      },
    ],
  });
  console.log("  ✓ Seed events created");

  console.log("\n✅ Seed complete.");
  console.log("   Admin login:    admin@treasury.local / Admin1234!");
  console.log("   Operator login: operator@treasury.local / Operator1234!");
  console.log("   Approver login: approver@treasury.local / Approver1234!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
