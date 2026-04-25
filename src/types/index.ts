export type CheckinStatus = "checked" | "unchecked" | "failed" | "unknown";
export type TodayUsedStatus = "exact" | "stale" | "pending" | "unavailable";
export type QueueLifecycleStatus = "idle" | "running" | "cooldown" | "paused" | "completed";
export type CheckinScope = "all" | "failed";
export type AutoCheckinStatus =
  | "disabled"
  | "scheduled"
  | "retrying"
  | "triggered"
  | "running"
  | "cooldown";

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

export interface AutoCheckinState {
  enabled: boolean;
  time: string;
  timezone: string;
  catchUpEnabled: boolean;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
  lastTriggeredDay: string | null;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
  status: AutoCheckinStatus;
}

export interface SyncState {
  checkinQueue: CheckinQueueState;
  usageSync: UsageSyncState;
  autoCheckin: AutoCheckinState;
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
  todayUsedRaw?: number | null;
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

export type DashboardAlertType = "rate_limit" | "auth_failed" | "sync_timeout";
export type DashboardAlertSeverity = "warning" | "destructive";

export interface DashboardAlert {
  type: DashboardAlertType;
  severity: DashboardAlertSeverity;
  title: string;
  message: string;
  count: number;
  usernames: string[];
  updatedAt: string | null;
}

export interface QuotaSummary {
  todayCheckinIncome: number;
  totalBalance: number;
  todayUsedRawTotal: number;
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
  usedQuota: number | null;
}

export interface QuotaDashboard {
  summary: QuotaSummary;
  accounts: AccountQuota[];
  alerts: DashboardAlert[];
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

export interface AuthSession {
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
}

export interface AuthConfig {
  username: string;
}

export interface LoginResult {
  authenticated: boolean;
  username: string;
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
  message: string;
  sync: SyncState;
}

export interface ImportAccountsResult {
  accountFile: string;
  count: number;
  usernames: string[];
}
