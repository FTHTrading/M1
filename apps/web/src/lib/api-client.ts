/**
 * Typed fetch wrapper for the Treasury OS API.
 * Base: http://localhost:4000/api/v1
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("treasury_token");
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${getBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
export interface LoginResponse {
  token: string;
  user: { id: string; email: string; name: string; role: string };
}
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
  me: () => api.get<LoginResponse["user"]>("/auth/me"),
};

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
export interface DashboardSummary {
  pendingMints: number;
  completedMints: number;
  pendingRedemptions: number;
  openBreaks: number;
  totalUsdcIssued: string;
  totalUsdtIssued: string;
  fiatCashBalance: string;
}
export const dashboardApi = {
  summary: () => api.get<DashboardSummary>("/reports/summary"),
};

// ------------------------------------------------------------------
// Mint requests
// ------------------------------------------------------------------
export interface MintRequest {
  id: string;
  reference: string;
  status: string;
  asset: string;
  requestedAmountCents: string;
  mintedUnits: string | null;
  entityId: string;
  entity?: { legalName: string };
  createdAt: string;
  updatedAt: string;
}
export interface MintRequestDetail extends MintRequest {
  settlementWallet?: { address: string; network: string; label: string };
  approvals?: Approval[];
  journalEntries?: JournalEntry[];
}
export const mintApi = {
  list: (params?: { status?: string; page?: number }) =>
    api.get<{ items: MintRequest[]; total: number }>(
      `/mint-requests?${new URLSearchParams(params as Record<string, string>)}`
    ),
  get: (id: string) => api.get<MintRequestDetail>(`/mint-requests/${id}`),
  create: (body: {
    entityId: string;
    treasuryAccountId: string;
    bankAccountId: string;
    settlementWalletId: string;
    asset: string;
    network: string;
    requestedAmountCents: number;
    memo?: string;
  }) => api.post<MintRequest>("/mint-requests", body),
  submit: (id: string) => api.post<MintRequest>(`/mint-requests/${id}/submit`, {}),
  fund: (id: string, wireRef: string) =>
    api.post<MintRequest>(`/mint-requests/${id}/fund`, { wireRef }),
  cancel: (id: string, reason: string) =>
    api.post<MintRequest>(`/mint-requests/${id}/cancel`, { reason }),
};

// ------------------------------------------------------------------
// Redemption requests
// ------------------------------------------------------------------
export interface RedemptionRequest {
  id: string;
  reference: string;
  status: string;
  asset: string;
  requestedUnits: string;
  expectedFiatCents: string | null;
  entityId: string;
  entity?: { legalName: string };
  createdAt: string;
}
export const redeemApi = {
  list: (params?: { status?: string }) =>
    api.get<{ items: RedemptionRequest[]; total: number }>(
      `/redemption-requests?${new URLSearchParams(params as Record<string, string>)}`
    ),
  get: (id: string) => api.get<RedemptionRequest>(`/redemption-requests/${id}`),
  create: (body: {
    entityId: string;
    treasuryAccountId: string;
    sourceWalletId: string;
    bankAccountId: string;
    asset: string;
    network: string;
    requestedUnits: string;
    memo?: string;
  }) => api.post<RedemptionRequest>("/redemption-requests", body),
  submit: (id: string) =>
    api.post<RedemptionRequest>(`/redemption-requests/${id}/submit`, {}),
  cancel: (id: string, reason: string) =>
    api.post<RedemptionRequest>(`/redemption-requests/${id}/cancel`, { reason }),
};

// ------------------------------------------------------------------
// Approvals
// ------------------------------------------------------------------
export interface Approval {
  id: string;
  status: string;
  decision?: string;
  note?: string;
  approverId?: string;
  approver?: { name: string };
  createdAt: string;
  mintRequestId?: string;
  redemptionRequestId?: string;
}
export const approvalsApi = {
  list: () => api.get<{ data: Approval[] }>("/approvals"),
  decide: (id: string, decision: "APPROVE" | "REJECT", note?: string) =>
    api.post<Approval>(`/approvals/${id}/decide`, { decision, note }),
};

// ------------------------------------------------------------------
// Entities
// ------------------------------------------------------------------
export interface Entity {
  id: string;
  legalName: string;
  kycStatus: string;
  entityType: string;
  createdAt: string;
}
export const entitiesApi = {
  list: () => api.get<{ data: Entity[] }>("/entities"),
  get: (id: string) => api.get<Entity>(`/entities/${id}`),
};

// ------------------------------------------------------------------
// Wallets
// ------------------------------------------------------------------
export interface Wallet {
  id: string;
  label: string;
  network: string;
  address: string;
  asset: string;
  whitelisted: boolean;
  entityId: string;
}
export const walletsApi = {
  list: () => api.get<{ data: Wallet[] }>("/wallets"),
  create: (body: Omit<Wallet, "id">) => api.post<Wallet>("/wallets", body),
  toggleWhitelist: (id: string, whitelisted: boolean) =>
    api.patch<Wallet>(`/wallets/${id}`, { whitelisted }),
};

// ------------------------------------------------------------------
// Reconciliation
// ------------------------------------------------------------------
export interface ReconRun {
  id: string;
  status: string;
  totalBreaks: number;
  resolvedBreaks: number;
  createdAt: string;
  entityId: string;
}
export interface ReconBreak {
  id: string;
  breakType: string;
  amountCents: string;
  description: string;
  resolved: boolean;
  runId: string;
}
export const reconApi = {
  runs: () => api.get<{ data: ReconRun[] }>("/reconciliation/runs"),
  breaks: (entityId: string) =>
    api.get<{ data: ReconBreak[] }>(`/reconciliation/breaks/${entityId}`),
  run: (entityId: string) =>
    api.post<ReconRun>("/reconciliation/run", { entityId }),
  resolve: (breakId: string, note: string) =>
    api.post<ReconBreak>(`/reconciliation/breaks/${breakId}/resolve`, { note }),
};

// ------------------------------------------------------------------
// Compliance
// ------------------------------------------------------------------
export interface ComplianceProfile {
  id: string;
  entityId: string;
  entity?: { legalName: string };
  kycStatus: string;
  screeningStatus: string;
  riskScore: number | null;
  updatedAt: string;
}
export const complianceApi = {
  profiles: () => api.get<{ data: ComplianceProfile[] }>("/compliance/profiles"),
  evaluate: (entityId: string, asset: string, amountCents: number) =>
    api.post<{ allowed: boolean; requiresApproval: boolean; reasons: string[] }>(
      "/compliance/evaluate",
      { entityId, asset, amountCents }
    ),
};

// ------------------------------------------------------------------
// Audit log
// ------------------------------------------------------------------
export interface AuditLog {
  id: string;
  action: string;
  actorId: string;
  actor?: { name: string };
  entityType: string;
  entityId: string;
  diff?: Record<string, unknown>;
  createdAt: string;
}
export const auditApi = {
  list: (params?: { page?: number; entityType?: string }) =>
    api.get<{ data: AuditLog[]; total: number }>(
      `/admin/audit-log?${new URLSearchParams(
        Object.entries(params ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
          if (value !== undefined) {
            acc[key] = String(value);
          }
          return acc;
        }, {}),
      )}`
    ),
};

// ------------------------------------------------------------------
// Journal entries (ledger)
// ------------------------------------------------------------------
export interface JournalEntry {
  id: string;
  description: string;
  postedAt: string;
  lines: { accountCode: string; debitCents: string; creditCents: string }[];
}
export const ledgerApi = {
  forMint: (mintId: string) =>
    api.get<{ data: JournalEntry[] }>(`/mint-requests/${mintId}/journal`),
};

// ------------------------------------------------------------------
// Bank accounts
// ------------------------------------------------------------------
export interface BankAccount {
  id: string;
  bankName: string;
  accountNumberMask: string;
  currency: string;
  entityId: string;
}
export const bankAccountsApi = {
  list: (entityId?: string) =>
    api.get<{ data: BankAccount[] }>(
      `/bank-accounts${entityId ? `?entityId=${entityId}` : ""}`
    ),
};

// ------------------------------------------------------------------
// Treasury accounts
// ------------------------------------------------------------------
export interface TreasuryAccount {
  id: string;
  name: string;
  entityId: string;
  description?: string;
}
export const treasuryAccountsApi = {
  list: (entityId?: string) =>
    api.get<{ data: TreasuryAccount[] }>(
      `/treasury-accounts${entityId ? `?entityId=${entityId}` : ""}`
    ),
};

// ------------------------------------------------------------------
// Assurance OS
// ------------------------------------------------------------------

export type CapabilityStatus =
  | "LIVE"
  | "IMPLEMENTED"
  | "PARTIAL"
  | "SIMULATED"
  | "DOCUMENTED_ONLY"
  | "MISSING";

export type ClaimSupportStatus =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "WEAKLY_SUPPORTED"
  | "UNSUPPORTED"
  | "MARKETING_ONLY"
  | "CANNOT_VERIFY";

export type GapSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
export type RatingTier = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "C";
export type AuditRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface RatingScore {
  id: string;
  category: string;
  label: string;
  score: number;
  weight: number;
  tier: RatingTier;
  notes: string;
}

export interface GapItem {
  id: string;
  gapKey: string;
  severity: GapSeverity;
  category: string;
  title: string;
  description: string;
  affectedClaims: string[];
  remediation: string;
  effortEstimate: string;
  externalDep: boolean;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedNote: string | null;
}

export interface AuditRunSummary {
  id: string;
  status: AuditRunStatus;
  overallScore: number | null;
  ratingTier: RatingTier | null;
  triggeredBy: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  schemaVersion: string | null;
  _count: { capabilities: number; claims: number; gapItems: number };
}

export interface AssuranceOverview {
  hasRun: boolean;
  message?: string;
  runId?: string;
  overallScore?: number;
  ratingTier?: RatingTier;
  completedAt?: string;
  categoryScores?: RatingScore[];
  topGaps?: GapItem[];
  claimDistribution?: Record<string, number>;
  capabilityDistribution?: Record<string, number>;
  gapDistribution?: Record<string, number>;
}

export interface CapabilityAssessment {
  id: string;
  capabilityKey: string;
  category: string;
  title: string;
  status: CapabilityStatus;
  maturityScore: number;
  confidence: string;
  evidenceSummary: string;
  gaps: string[];
  evidence: {
    id: string;
    evidenceType: string;
    reference: string;
    description: string;
    found: boolean;
    weight: number;
  }[];
}

export interface ClaimAssessment {
  id: string;
  claimKey: string;
  category: string;
  claim: string;
  source: string;
  support: ClaimSupportStatus;
  confidence: string;
  evidenceRefs: string[];
  analystNote: string;
}

export const assuranceApi = {
  overview: () =>
    api.get<AssuranceOverview>("/assurance/overview"),

  triggerRun: () =>
    api.post<{ auditRunId: string; status: string }>("/assurance/runs", {}),

  runs: (page = 1) =>
    api.get<{ items: AuditRunSummary[]; total: number; page: number; pageSize: number }>(
      `/assurance/runs?page=${page}`,
    ),

  run: (id: string) =>
    api.get<AuditRunSummary & { ratingScores: RatingScore[] }>(`/assurance/runs/${id}`),

  capabilities: (runId: string, params?: { category?: string; status?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<{ items: CapabilityAssessment[]; total: number }>(
      `/assurance/runs/${runId}/capabilities${qs ? `?${qs}` : ""}`,
    );
  },

  claims: (runId: string, params?: { support?: string; category?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<{ items: ClaimAssessment[]; total: number }>(
      `/assurance/runs/${runId}/claims${qs ? `?${qs}` : ""}`,
    );
  },

  gaps: (runId: string, params?: { severity?: string; resolved?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return api.get<{ items: GapItem[]; total: number }>(
      `/assurance/runs/${runId}/gaps${qs ? `?${qs}` : ""}`,
    );
  },

  resolveGap: (runId: string, gapId: string, note?: string) =>
    api.patch<{ resolved: boolean }>(`/assurance/runs/${runId}/gaps/${gapId}/resolve`, {
      note,
    }),
};
