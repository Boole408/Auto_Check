export type CheckinStatus = "checked" | "unchecked" | "failed" | "unknown";
export type TodayUsedStatus = "exact" | "stale" | "pending" | "unavailable";
export type QueueLifecycleStatus = "idle" | "running" | "cooldown" | "paused" | "completed";
export type CheckinScope = "all" | "failed";

export interface QueueProgress {
  total: number;
  completed: number;
  pending: number;
  failed: number;
  skipped: number;
}

export interface QueueStateBase {
  status: QueueLifecycleStatus;
  progress: QueueProgress;
  cooldownUntil: string | null;
  currentUsername: string | null;
  updatedAt: string;
  message: string;
}

export interface CheckinQueueState extends QueueStateBase {
  scope: CheckinScope;
}

export interface UsageSyncState extends QueueStateBase {}

export interface SyncState {
  checkinQueue: CheckinQueueState;
  usageSync: UsageSyncState;
}

export interface AccountDataSource {
  checkin: "remote" | "cache";
  todayUsed: "log-stat" | "cache" | "pending";
}

export interface AccountQuota {
  username: string;
  displayName: string;
  signedToday: boolean;
  checkinStatus: CheckinStatus;
  checkinMessage: string;
  todayUsed: number | null;
  todayUsedStatus: TodayUsedStatus;
  todayUsedUpdatedAt?: string | null;
  totalQuota: number;
  remainingQuota: number;
  balance: number;
  usagePercent: number;
  lastCheckinReward: number;
  currencySymbol: string;
  updatedAt: string;
  dataSource?: AccountDataSource;
}

export interface CoverageStat {
  exactOrStaleAccounts: number;
  totalAccounts: number;
}

export interface QuotaSummary {
  todayCheckinIncome: number;
  totalBalance: number;
  todayUsed: number;
  todayRemaining: number;
  accountCount: number;
  checkedInCount: number;
  todayUsedCoverage: CoverageStat;
  todayRemainingCoverage: CoverageStat;
}

export interface TrendPoint {
  date: string;
  checkinIncome: number;
  usedQuota: number;
}

export interface QuotaDashboard {
  summary: QuotaSummary;
  accounts: AccountQuota[];
  trend: TrendPoint[];
  refreshedAt: string;
  currencySymbol: string;
  errors: string[];
  accountFile: string;
  sync: SyncState;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface CheckinResult {
  username: string;
  displayName: string;
  signedToday: boolean;
  reward: number;
  message: string;
  status: CheckinStatus;
  updatedAt: string;
}

export interface CheckinAllResult {
  started: boolean;
  scope: CheckinScope;
  sync: SyncState;
}
