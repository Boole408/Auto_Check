import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileUp,
  Gauge,
  LoaderCircle,
  Moon,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sun,
  WalletCards,
  Zap
} from "lucide-react";
import { AccountImportModal } from "@/components/AccountImportModal";
import { CountdownTimer } from "@/components/CountdownTimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  describeAutoCheckin,
  formatCompactTime,
  formatTime,
  getAccountInitial,
  getAccountQueueHint,
  getAutoCheckinLabel,
  getCheckinActionLabel,
  getCheckinSourceText,
  getCheckinStatusText,
  getSingleActionLabel,
  getTodayUsedStatusText,
  getTodayUsedText,
  getUsageSourceText,
  matchesFilter,
  money,
  normalizeUsageQueue,
  percent,
  usageTone
} from "@/lib/formatters";
import { ApiError, checkinAccount, checkinAll, getQuotaMonitor } from "@/services/api";
import type {
  AccountQuota,
  DashboardAlert,
  CheckinScope,
  ImportAccountsResult,
  QuotaDashboard,
  TodayUsedStatus,
} from "@/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 60_000;
const FILTERS = [
  { key: "all", label: "全部" },
  { key: "checked", label: "已签到" },
  { key: "pending", label: "待同步" },
  { key: "error", label: "异常" },
  { key: "unchecked", label: "未签到" }
] as const;

type AccountFilter = (typeof FILTERS)[number]["key"];
type AnalysisTab = "comparison" | "checkinTrend" | "usageTrend";
type RefreshToast = {
  tone: "success" | "error";
  message: string;
} | null;

const PRIMARY_FILTERS = FILTERS.filter((item) => item.key !== "checked");
const EXTRA_FILTERS = FILTERS.filter((item) => item.key === "checked");
const ANALYSIS_TABS: Array<{
  key: AnalysisTab;
  label: string;
  title: string;
  description: string;
}> = [
  {
    key: "comparison",
    label: "账号额度对比",
    title: "账号额度对比",
    description: "对比各账号今日已用与剩余额度，默认只展开一张图。"
  },
  {
    key: "checkinTrend",
    label: "签到趋势",
    title: "签到趋势",
    description: "观察最近周期的签到收益变化。"
  },
  {
    key: "usageTrend",
    label: "用量趋势",
    title: "用量趋势",
    description: "聚焦最近周期的实际用量变化。"
  }
];

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const ACCOUNT_TABLE_GRID =
  "xl:grid-cols-[minmax(0,2.35fr)_0.92fr_0.9fr_0.96fr_1.02fr_1.04fr_0.9fr_96px_132px]";

function getCheckinBadge(account: AccountQuota) {
  const className =
    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]";
  if (account.signedToday) {
    return (
      <Badge
        variant="success"
        className={cn(className, "border-[#BDEDDD] bg-[#E6FAF2] text-[#08785C]")}
      >
        今日已签到
      </Badge>
    );
  }
  if (account.checkinStatus === "failed") {
    return (
      <Badge
        variant="destructive"
        className={cn(className, "border-red-500/16 bg-[rgba(233,201,194,0.82)] text-red-800")}
      >
        签到异常
      </Badge>
    );
  }
  if (account.checkinStatus === "unknown") {
    return (
      <Badge
        variant="outline"
        className={cn(className, "border-[#DDEAE5] bg-[#F3F8F5] text-[#4D625B] dark:border-[#294038] dark:bg-[#16241f] dark:text-[#A3BBB3]")}
      >
        状态待同步
      </Badge>
    );
  }
  return (
    <Badge
      variant="warning"
      className={cn(className, "border-amber-500/16 bg-[rgba(227,212,176,0.84)] text-amber-800")}
    >
      未签到
    </Badge>
  );
}

function getTodayUsedBadge(status: TodayUsedStatus) {
  switch (status) {
    case "exact":
      return (
        <Badge
          variant="success"
          className="rounded-full border-[#BDEDDD] bg-[#E6FAF2] px-2.5 py-0.5 text-[11px] font-semibold text-[#08785C] shadow-[inset_0_1px_0_rgba(255,255,255,0.46)]"
        >
          精确
        </Badge>
      );
    case "stale":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-[#DDEAE5] bg-[#F3F8F5] px-2.5 py-0.5 text-[11px] font-semibold text-[#4D625B] shadow-[inset_0_1px_0_rgba(255,255,255,0.46)] dark:border-[#294038] dark:bg-[#16241f] dark:text-[#A3BBB3]"
        >
          缓存
        </Badge>
      );
    case "unavailable":
      return (
        <Badge
          variant="destructive"
          className="rounded-full border-red-500/16 bg-[rgba(233,201,194,0.82)] px-2.5 py-0.5 text-[11px] font-semibold text-red-800 shadow-[inset_0_1px_0_rgba(245,236,234,0.42)]"
        >
          不可用
        </Badge>
      );
    default:
      return (
        <Badge
          variant="warning"
          className="rounded-full border-amber-500/16 bg-[rgba(227,212,176,0.84)] px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 shadow-[inset_0_1px_0_rgba(245,239,226,0.4)]"
        >
          待同步
        </Badge>
      );
  }
}

function QueueMetaCell({
  label,
  value,
  className,
  valueClassName
}: {
  label: string;
  value: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[1rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] px-3.5 py-3 shadow-[0_10px_24px_rgba(16,42,36,0.04),inset_0_1px_0_rgba(255,255,255,0.5)] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)] dark:shadow-[0_12px_20px_rgba(0,0,0,0.2)]",
        className
      )}
    >
      <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">{label}</p>
      <div className={cn("mt-1.5 text-sm font-semibold text-foreground/90", valueClassName)}>{value}</div>
    </div>
  );
}

function getAlertPresentation(alert: DashboardAlert) {
  switch (alert.type) {
    case "auth_failed":
      return {
        Icon: ShieldAlert,
        cardClassName:
          "border-[#F4C5C5] bg-[linear-gradient(135deg,rgba(239,107,107,0.14),rgba(255,255,255,0.94))]",
        iconClassName: "text-red-600 dark:text-red-300",
        badgeVariant: "destructive" as const
      };
    case "sync_timeout":
      return {
        Icon: Clock3,
        cardClassName:
          "border-[#F7D9A6] bg-[linear-gradient(135deg,rgba(242,169,59,0.14),rgba(255,255,255,0.94))]",
        iconClassName: "text-amber-600 dark:text-amber-300",
        badgeVariant: "warning" as const
      };
    default:
      return {
        Icon: AlertTriangle,
        cardClassName:
          "border-[#F7D9A6] bg-[linear-gradient(135deg,rgba(242,169,59,0.12),rgba(255,255,255,0.94))]",
        iconClassName: "text-amber-600 dark:text-amber-300",
        badgeVariant: "warning" as const
      };
  }
}

export default function QuotaMonitorPage() {
  const MANUAL_REFRESH_MIN_SPIN_MS = 850;
  const [dashboard, setDashboard] = useState<QuotaDashboard | null>(null);
  const [selectedUsername, setSelectedUsername] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [workingAccount, setWorkingAccount] = useState<string | null>(null);
  const [workingScope, setWorkingScope] = useState<CheckinScope | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshToast, setRefreshToast] = useState<RefreshToast>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("cw-theme") === "dark");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("comparison");
  const [autoCheckinExpanded, setAutoCheckinExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const selectedRef = useRef("");

  async function loadDashboard(options: {
    silent?: boolean;
    force?: boolean;
    selected?: string | null;
    signal?: AbortSignal;
  } = {}): Promise<boolean> {
    const { silent = false, force = false, selected = selectedRef.current || null, signal } = options;

    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const data = await getQuotaMonitor({
        signal,
        force,
        selectedUsername: selected
      });

      setDashboard(data);
      setSelectedUsername((current) => {
        if (current && data.accounts.some((account) => account.username === current)) {
          return current;
        }
        return data.accounts[0]?.username ?? "";
      });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }

      const message =
        error instanceof ApiError
          ? error.message
          : "网络异常，请检查服务是否正常启动";
      setNotice(message);
      return false;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    selectedRef.current = selectedUsername;
  }, [selectedUsername]);

  useEffect(() => {
    setDetailExpanded(false);
  }, [selectedUsername]);

  useEffect(() => {
    if (filter === "checked") {
      setMoreFiltersOpen(true);
    }
  }, [filter]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard({ signal: controller.signal });

    const timer = window.setInterval(() => {
      void loadDashboard({ silent: true, selected: selectedRef.current || null });
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!dashboard || !selectedUsername) return;
    void loadDashboard({ silent: true, selected: selectedUsername });
  }, [selectedUsername]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("cw-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    if (!refreshToast) return;

    const timer = window.setTimeout(() => {
      setRefreshToast(null);
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [refreshToast]);

  const selectedAccount = useMemo(() => {
    if (!dashboard?.accounts.length) return null;
    return (
      dashboard.accounts.find((account) => account.username === selectedUsername) ??
      dashboard.accounts[0]
    );
  }, [dashboard, selectedUsername]);

  const filteredAccounts = useMemo(
    () => (dashboard?.accounts ?? []).filter((account) => matchesFilter(account, filter)),
    [dashboard?.accounts, filter]
  );

  const currencySymbol =
    dashboard?.currencySymbol || selectedAccount?.currencySymbol || dashboard?.accounts[0]?.currencySymbol || "楼";
  const checkinQueue = dashboard?.sync.checkinQueue;
  const usageQueue = useMemo(
    () => normalizeUsageQueue(dashboard?.sync.usageSync),
    [dashboard?.sync.usageSync]
  );
  const autoCheckin = dashboard?.sync.autoCheckin;
  const failedAccountsCount = checkinQueue?.progress.failed ?? 0;
  const bulkCheckinBusy = workingScope === "all" || checkinQueue?.status === "running";
  const activeAlerts = dashboard?.alerts ?? [];
  const checkinCompleted = checkinQueue?.progress.completed ?? 0;
  const checkinSkipped = checkinQueue?.progress.skipped ?? 0;
  const checkinFailed = checkinQueue?.progress.failed ?? 0;
  const checkinTotal = checkinQueue?.progress.total ?? 0;
  const checkinHandled = checkinCompleted + checkinSkipped;
  const usagePending =
    usageQueue?.progress.pending ??
    Math.max(
      (usageQueue?.progress.total ?? 0) -
        (usageQueue?.progress.completed ?? 0) -
        (usageQueue?.progress.skipped ?? 0) -
        (usageQueue?.progress.failed ?? 0),
      0
    );
  const usageCoverageCompleted = dashboard?.summary.todayUsedCoverage.exactOrStaleAccounts ?? 0;
  const usageCoverageTotal = dashboard?.summary.todayUsedCoverage.totalAccounts ?? 0;

  async function handleSingleCheckin(account: AccountQuota) {
    if (account.signedToday) return;

    try {
      setWorkingAccount(account.username);
      const result = await checkinAccount(account.username);
      setNotice(result.message || "签到成功");
      await loadDashboard({ silent: true, force: true, selected: account.username });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "站点限流，请稍后重试"
          : error instanceof Error
            ? error.message
            : "签到失败";
      setNotice(message);
    } finally {
      setWorkingAccount(null);
    }
  }

  async function handleCheckinAll(scope: CheckinScope) {
    try {
      setWorkingScope(scope);
      const result = await checkinAll(scope);
      setNotice(result.message);
      await loadDashboard({ silent: true, force: true, selected: selectedUsername || null });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "站点限流，请稍后重试"
          : error instanceof Error
            ? error.message
            : scope === "failed"
              ? "失败账号重试失败"
              : "一键签到失败";
      setNotice(message);
    } finally {
      setWorkingScope(null);
    }
  }

  async function handleImportSuccess(result: ImportAccountsResult) {
    setNotice(`已导入 ${result.count} 个账号`);
    await loadDashboard({
      silent: true,
      force: true,
      selected: selectedRef.current || null
    });
  }

  async function handleRefresh() {
    if (manualRefreshing || refreshing) return;

    const startedAt = Date.now();
    setManualRefreshing(true);
    setRefreshToast(null);

    try {
      const ok = await loadDashboard({
        silent: true,
        force: true,
        selected: selectedUsername || null
      });

      const elapsed = Date.now() - startedAt;
      if (elapsed < MANUAL_REFRESH_MIN_SPIN_MS) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, MANUAL_REFRESH_MIN_SPIN_MS - elapsed)
        );
      }

      if (ok) {
        setNotice("数据刷新成功，面板已同步最新状态");
        setRefreshToast({
          tone: "success",
          message: "刷新成功，页面已更新到最新数据。"
        });
      } else {
        setRefreshToast({
          tone: "error",
          message: "刷新失败，请查看顶部提示后重试。"
        });
      }
    } finally {
      setManualRefreshing(false);
    }
  }

  const summaryCards = [
    {
      title: "今日总签到收益",
      value: money(dashboard?.summary.todayCheckinIncome ?? 0, currencySymbol),
      icon: Zap,
      hint: `${dashboard?.summary.checkedInCount ?? 0}/${dashboard?.summary.accountCount ?? 0} 个账号已签到`
    },
    {
      title: "总账号余额",
      value: money(dashboard?.summary.totalBalance ?? 0, currencySymbol),
      icon: WalletCards,
      hint: "仅统计 quota 主余额"
    },
    {
      title: "今日已用额度",
      value: money(dashboard?.summary.todayUsed ?? 0, currencySymbol),
      icon: Activity,
      hint: `覆盖 ${dashboard?.summary.todayUsedCoverage.exactOrStaleAccounts ?? 0}/${dashboard?.summary.todayUsedCoverage.totalAccounts ?? 0}`
    },
    {
      title: "今日剩余额度",
      value: money(dashboard?.summary.todayRemaining ?? 0, currencySymbol),
      icon: Gauge,
      hint: `覆盖 ${dashboard?.summary.todayRemainingCoverage.exactOrStaleAccounts ?? 0}/${dashboard?.summary.todayRemainingCoverage.totalAccounts ?? 0}`
    }
  ];

  const accountCount = dashboard?.summary.accountCount ?? dashboard?.accounts.length ?? 0;
  const checkinDisplayTotal = checkinTotal || accountCount;
  const usageDisplayTotal = usageCoverageTotal || accountCount;
  const issueAccountsCount = (dashboard?.accounts ?? []).filter(
    (account) => account.checkinStatus === "failed" || account.todayUsedStatus === "unavailable"
  ).length;
  const overallTaskTotal = checkinDisplayTotal + usageDisplayTotal;
  const overallTaskCompleted = checkinHandled + usageCoverageCompleted;
  const overallProgress = overallTaskTotal ? (overallTaskCompleted / overallTaskTotal) * 100 : 0;
  const isRefreshBusy = manualRefreshing || refreshing;
  const primaryOverviewCards = [
    {
      label: "签到完成",
      value: `${checkinHandled} / ${checkinDisplayTotal}`,
      hint: checkinFailed ? `${checkinFailed} 个异常待处理` : "账号已完成签到",
      icon: CheckCircle2
    },
    {
      label: "用量同步",
      value: `${usageCoverageCompleted} / ${usageDisplayTotal}`,
      hint: usagePending ? `${usagePending} 个账号待同步` : "同步覆盖已完成",
      icon: RefreshCw
    },
    {
      label: "异常账号",
      value: issueAccountsCount,
      hint: issueAccountsCount ? "优先处理登录或同步异常" : "当前没有明显异常",
      icon: ShieldAlert
    }
  ];
  const selectedUsageTone = usageTone(selectedAccount?.usagePercent ?? 0);
  const condensedAlerts: Array<{
    key: string;
    label: string;
    value: ReactNode;
    variant: "outline" | "warning" | "destructive";
  }> = [
    ...(notice ? [{ key: "notice", label: "系统提示", value: notice, variant: "outline" as const }] : []),
    ...activeAlerts.slice(0, 3).map((alert) => ({
      key: alert.type,
      label: alert.title,
      value: alert.message,
      variant: getAlertPresentation(alert).badgeVariant
    })),
    ...(checkinQueue?.status === "cooldown"
      ? [
          {
            key: "checkin-cooldown",
            label: "签到冷却",
            value: (
              <>
                <CountdownTimer targetTime={checkinQueue.cooldownUntil} className="font-semibold" />
                {" 后自动继续"}
              </>
            ),
            variant: "warning" as const
          }
        ]
      : []),
    ...(usageQueue?.status === "cooldown"
      ? [
          {
            key: "usage-cooldown",
            label: "同步冷却",
            value: (
              <>
                <CountdownTimer targetTime={usageQueue.cooldownUntil} className="font-semibold" />
                {" 后自动恢复"}
              </>
            ),
            variant: "warning" as const
          }
        ]
      : [])
  ];

  const comparisonData =
    dashboard?.accounts.map((account) => ({
      name: account.displayName || account.username,
      todayUsed: account.todayUsed ?? 0,
      remainingQuota: account.remainingQuota,
      balance: account.balance
    })) ?? [];
  const trendData = dashboard?.trend ?? [];

  const selectedAccountMetrics = selectedAccount
    ? [
        {
          label: "今日已用",
          value: getTodayUsedText(selectedAccount),
          hint: getUsageSourceText(selectedAccount)
        },
        {
          label: "剩余额度",
          value: money(selectedAccount.remainingQuota, selectedAccount.currencySymbol),
          hint: `总额度 ${money(selectedAccount.totalQuota, selectedAccount.currencySymbol)}`
        },
        {
          label: "最近签到收益",
          value: money(selectedAccount.lastCheckinReward, selectedAccount.currencySymbol),
          hint: selectedAccount.checkinMessage
        }
      ]
    : [];
  const selectedAccountCoreFields = selectedAccount
    ? [
        {
          label: "签到状态",
          value: getCheckinStatusText(selectedAccount),
          hint: selectedAccount.checkinMessage,
          icon: CheckCircle2
        },
        {
          label: "用量同步",
          value: getUsageSourceText(selectedAccount),
          hint: `同步于 ${formatTime(selectedAccount.todayUsedUpdatedAt)}`,
          icon: Activity
        },
        {
          label: "刷新时间",
          value: formatTime(selectedAccount.updatedAt),
          hint: "账号摘要最近更新时间",
          icon: Clock3
        },
        {
          label: "排队状态",
          value: getAccountQueueHint(selectedAccount, checkinQueue, usageQueue),
          hint: "用于定位当前是否仍在后台处理",
          icon: RefreshCw
        }
      ]
    : [];
  const selectedAccountExtraFields = selectedAccount
    ? [
        {
          label: "签到来源",
          value: getCheckinSourceText(selectedAccount),
          hint: "本地缓存与远程确认来源"
        },
        {
          label: "总额度",
          value: money(selectedAccount.totalQuota, selectedAccount.currencySymbol),
          hint: `账号余额 ${money(selectedAccount.balance, selectedAccount.currencySymbol)}`
        },
        {
          label: "使用率",
          value: percent(selectedAccount.usagePercent),
          hint: "按总额度换算"
        },
        {
          label: "用量状态",
          value: getTodayUsedStatusText(selectedAccount.todayUsedStatus),
          hint: getUsageSourceText(selectedAccount)
        }
      ]
    : [];
  const analysisMeta = ANALYSIS_TABS.find((item) => item.key === analysisTab) ?? ANALYSIS_TABS[0];
  const chartGridStroke = darkMode ? "#1F322C" : "#E8F0EC";
  const chartTooltipStyle = darkMode
    ? {
        borderRadius: "14px",
        border: "1px solid #294038",
        background: "rgba(19,32,27,0.96)"
      }
    : {
        borderRadius: "14px",
        border: "1px solid #DDEAE5",
        background: "rgba(255,255,255,0.92)"
      };
  const chartUsedColor = "#34C79A";
  const chartRemainingColor = "#7BE3C2";
  const chartTooltipTitleColor = darkMode ? "#E7F7F0" : "#102A24";
  const chartTooltipValueColor = "#16A176";

  return (
    <main className="quota-monitor-page relative min-h-screen overflow-x-hidden overflow-y-auto bg-[radial-gradient(circle_at_20%_0%,rgba(52,199,154,0.08),transparent_26%),linear-gradient(180deg,#F8FCFA_0%,#F3F8F5_100%)] text-foreground dark:bg-[radial-gradient(circle_at_20%_0%,rgba(52,199,154,0.12),transparent_24%),linear-gradient(180deg,#0D1714_0%,#111D19_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-7rem] top-[-7rem] h-64 w-64 rounded-full bg-[#DDF8EE]/14 blur-[100px] dark:bg-[#1D4436]/28" />
        <div className="absolute right-[-8rem] top-0 h-72 w-72 rounded-full bg-[#ECFBF6]/18 blur-[110px] dark:bg-[#173228]/28" />
        <div className="absolute bottom-[-8rem] left-1/4 h-64 w-64 rounded-full bg-[#DDF8EE]/10 blur-[120px] dark:bg-[#133027]/24" />
      </div>

      <div className="relative flex min-h-screen w-full flex-col gap-3 px-4 py-4 sm:px-6">
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex shrink-0 flex-col gap-3 rounded-[1.55rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.9)] px-4 py-3 shadow-[0_12px_32px_rgba(16,42,36,0.06)] backdrop-blur-md dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.32)] lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-[1.05rem] bg-[linear-gradient(135deg,#34C79A,#7BE3C2)] text-white shadow-[0_10px_24px_rgba(52,199,154,0.28)]">
                <Zap className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-[1.34rem] font-black tracking-tight text-[#102A24] dark:text-[#E7F7F0] sm:text-[1.6rem]">
                  CW-Ops 账户管理系统
                </h1>
                <p className="mt-0.5 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                  聚焦监测、用量同步和多账号数据统筹，保障额度与生产能力可视可控。
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="min-w-[144px]">
              <Select value="caowo" onValueChange={() => undefined}>
                <SelectTrigger className="h-9 rounded-full border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="caowo">CAOWO</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="h-9 border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]"
              onClick={() => setImportModalOpen(true)}
            >
              <FileUp className="h-4 w-4" />
              账号导入
            </Button>

            <Button
              variant={darkMode ? "secondary" : "outline"}
              className={cn(
                "h-9 px-4 text-xs",
                darkMode
                  ? "border-[#294038] bg-[rgba(19,31,27,0.92)] text-[#E7F7F0] shadow-[0_8px_18px_rgba(0,0,0,0.26)]"
                  : "border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] text-[#2F4A43] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
              )}
              onClick={() => setDarkMode((value) => !value)}
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              主题
            </Button>

            <Button
              variant="outline"
              className={cn(
                "h-9 border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-transform active:scale-[0.98] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]",
                isRefreshBusy &&
                  "cursor-wait border-[#9EDCC6] bg-[rgba(232,249,242,0.9)] text-[#1D6C55] shadow-[0_0_0_3px_rgba(52,199,154,0.12)] dark:border-[#3C7E68] dark:bg-[rgba(24,44,37,0.96)]"
              )}
              onClick={() => void handleRefresh()}
              disabled={isRefreshBusy}
              aria-busy={isRefreshBusy}
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshBusy && "animate-spin")} />
              {isRefreshBusy ? "刷新中..." : "刷新"}
            </Button>

            <Button
              className="h-9 bg-[linear-gradient(135deg,#34C79A,#22B889)] px-4 text-xs text-white shadow-[0_8px_20px_rgba(52,199,154,0.28)]"
              onClick={() => void handleCheckinAll("all")}
              disabled={
                !dashboard?.accounts.length ||
                workingScope !== null ||
                checkinQueue?.status === "cooldown" ||
                checkinQueue?.status === "running"
              }
            >
              {bulkCheckinBusy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {getCheckinActionLabel(checkinQueue, bulkCheckinBusy)}
            </Button>
          </div>
        </motion.header>

        {condensedAlerts.length ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex shrink-0 flex-wrap items-center gap-2 rounded-[1.2rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] px-3 py-2 shadow-[0_10px_22px_rgba(16,42,36,0.05)] dark:border-[#233A33] dark:bg-[rgba(19,31,27,0.88)] dark:shadow-[0_14px_28px_rgba(0,0,0,0.28)]"
          >
            {condensedAlerts.map((item) => (
              <Badge key={item.key} variant={item.variant} className="max-w-full truncate px-3 py-1 text-[11px]">
                {item.label}：{item.value}
              </Badge>
            ))}
          </motion.div>
        ) : null}

        <div className="grid gap-2.5 xl:grid-cols-12 xl:items-stretch">
          <section className="flex h-full flex-col gap-2.5 xl:col-span-8">
            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="shrink-0">
              <Card className="overflow-hidden border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
                <CardHeader className="pb-2.5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <CardTitle className="text-[1.08rem] text-[#102A24] dark:text-[#E7F7F0]">今日总览</CardTitle>
                      <CardDescription className="mt-1 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                        刷新时间 {formatCompactTime(dashboard?.refreshedAt)}，优先显示今天需要处理的任务与告警信息。
                      </CardDescription>
                    </div>
                    <p className="hidden text-[11px] text-[#9AABA5] dark:text-[#657A73] xl:block">
                      列表与详情已压缩到单屏运营视图
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  <div className="grid gap-2.5 md:grid-cols-3">
                    {primaryOverviewCards.map((metric) => {
                      const Icon = metric.icon;
                      return (
                        <div
                          key={metric.label}
                          className="rounded-[1.12rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] px-3.5 py-2.5 shadow-[0_10px_22px_rgba(16,42,36,0.05)] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)] dark:shadow-[0_12px_22px_rgba(0,0,0,0.22)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold tracking-[0.12em] text-[#71867F] dark:text-[#89A39B]">
                                {metric.label}
                              </p>
                              <p className="mt-1 text-[1.42rem] font-black leading-none tracking-tight text-[#102A24] dark:text-[#F0FBF6]">
                                {metric.value}
                              </p>
                              <p className="mt-1 text-[10px] text-[#9AABA5] dark:text-[#667B73]">{metric.hint}</p>
                            </div>
                            <span className="grid h-9 w-9 place-items-center rounded-full border border-[#BDEDDD] bg-[#ECFBF6] text-[#34C79A] shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]">
                              <Icon className="h-[18px] w-[18px]" />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-[1.18rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.84)] px-3.5 py-2.5 shadow-[0_10px_22px_rgba(16,42,36,0.04),inset_0_1px_0_rgba(255,255,255,0.76)] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)] dark:shadow-[0_12px_24px_rgba(0,0,0,0.22)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-[#2F4A43] dark:text-[#D5ECE4]">今日任务完成度</p>
                        <p className="mt-1 text-[11px] text-[#71867F] dark:text-[#89A39B]">
                          签到状态：成功 {checkinCompleted}，跳过 {checkinSkipped}，失败 {checkinFailed}，
                          用量同步：{usageCoverageCompleted}/{usageDisplayTotal}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[1.2rem] font-black leading-none tracking-tight text-[#102A24] dark:text-[#F0FBF6]">
                          {overallTaskTotal ? percent(overallProgress) : "0.0%"}
                        </p>
                        <p className="mt-1 text-[11px] text-[#71867F] dark:text-[#89A39B]">
                          {overallTaskCompleted}/{overallTaskTotal || 0}
                        </p>
                      </div>
                    </div>
                    <Progress
                      className="mt-2.5 h-2 bg-[#E7F0EC]"
                      value={overallProgress}
                      indicatorClassName="bg-[linear-gradient(90deg,#34C79A,#7BE3C2)]"
                    />
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#71867F] dark:text-[#89A39B]">
                      <span>自动签到：{getAutoCheckinLabel(autoCheckin?.status)}</span>
                      <span>下次执行：{formatCompactTime(autoCheckin?.nextRunAt)}</span>
                      <span>补跑策略：{autoCheckin?.catchUpEnabled ? "当天补签" : "严格整点"}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => setAutoCheckinExpanded((value) => !value)}
                      >
                        {autoCheckinExpanded ? "收起明细" : "查看调度详情"}
                      </Button>
                    </div>
                    {autoCheckinExpanded ? (
                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <QueueMetaCell
                          label="计划时间"
                          value={`${autoCheckin?.time || "00:01"} (${autoCheckin?.timezone || "Asia/Shanghai"})`}
                        />
                        <QueueMetaCell label="最近触发" value={formatTime(autoCheckin?.lastTriggeredAt)} />
                        <QueueMetaCell label="最近尝试" value={formatTime(autoCheckin?.lastAttemptAt)} />
                        <QueueMetaCell
                          label="调度状态"
                          value={autoCheckin?.enabled ? describeAutoCheckin(autoCheckin) : "当前未启用"}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                    {summaryCards.map((card) => {
                      const Icon = card.icon;
                      return (
                        <div
                          key={card.title}
                          className="rounded-[1.08rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] px-3.5 py-2.5 shadow-[0_10px_18px_rgba(16,42,36,0.05)] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)] dark:shadow-[0_12px_20px_rgba(0,0,0,0.22)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] text-[#71867F] dark:text-[#89A39B]">{card.title}</p>
                              <p className="mt-1 text-[1.18rem] font-black tracking-tight text-[#102A24] dark:text-[#F0FBF6]">
                                {card.value}
                              </p>
                              <p className="mt-1 text-[10px] text-[#9AABA5] dark:text-[#667B73]">{card.hint}</p>
                            </div>
                            <span className="grid h-8.5 w-8.5 place-items-center rounded-full border border-[#BDEDDD] bg-[#ECFBF6] text-[#34C79A]">
                              <Icon className="h-4 w-4" />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.section>

            <motion.section
              variants={listVariants}
              initial="hidden"
              animate="show"
              className="flex-1"
            >
              <Card className="flex h-full flex-col border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
                <CardHeader className="pb-2.5">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <CardTitle className="text-[1.08rem] text-[#102A24] dark:text-[#E7F7F0]">多账号列表</CardTitle>
                      <CardDescription className="mt-1 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                        智能监测 | 同步和分析状态筛选账号。
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-full border border-[#DDEAE5] bg-[rgba(255,255,255,0.62)] p-1 dark:border-[#294038] dark:bg-[rgba(20,31,27,0.82)]">
                      {PRIMARY_FILTERS.map((item) => (
                        <Button
                          key={item.key}
                          size="sm"
                          variant={filter === item.key ? "default" : "ghost"}
                          className={cn(
                            "h-7 rounded-full px-3 text-[11px] shadow-none",
                            filter === item.key
                              ? "bg-[linear-gradient(135deg,#34C79A,#22B889)] text-white shadow-[0_6px_16px_rgba(52,199,154,0.22)]"
                              : "text-[#71867F]"
                          )}
                          onClick={() => setFilter(item.key)}
                        >
                          {item.label}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant={moreFiltersOpen || filter === "checked" ? "secondary" : "ghost"}
                        className="h-7 rounded-full px-3 text-[11px] shadow-none"
                        onClick={() => setMoreFiltersOpen((value) => !value)}
                      >
                        更多筛选
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-full px-3 text-[11px] text-[#71867F] shadow-none"
                        onClick={() => void handleCheckinAll("failed")}
                        disabled={
                          failedAccountsCount === 0 ||
                          workingScope !== null ||
                          checkinQueue?.status === "cooldown"
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        重试失败
                      </Button>
                    </div>
                  </div>
                  {moreFiltersOpen ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {EXTRA_FILTERS.map((item) => (
                        <Button
                          key={item.key}
                          size="sm"
                          variant={filter === item.key ? "secondary" : "outline"}
                          className="h-7 rounded-full px-3 text-[11px]"
                          onClick={() => setFilter(item.key)}
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </CardHeader>

                <CardContent className="flex flex-1 flex-col pt-0">
                  {loading ? (
                    <div className="grid gap-1">
                      {Array.from({ length: 10 }).map((_, index) => (
                        <div
                          key={`loading-row-${index}`}
                          className="h-8 animate-pulse rounded-[0.9rem] bg-[rgba(236,251,246,0.82)]"
                        />
                      ))}
                    </div>
                  ) : filteredAccounts.length ? (
                    <div>
                      <div className="space-y-1">
                        <div
                          className={cn(
                            "hidden items-center gap-2.5 rounded-[0.92rem] border border-[#E6EFEB] bg-[rgba(255,255,255,0.88)] px-3 py-1.5 text-[10px] font-semibold text-[#71867F] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.88)] dark:text-[#8DA69E] xl:grid",
                            ACCOUNT_TABLE_GRID
                          )}
                        >
                          <span>账号</span>
                          <span className="text-center">签到</span>
                          <span className="text-center">用量</span>
                          <span className="text-center">今日已用</span>
                          <span className="text-center">总额度</span>
                          <span className="text-center">剩余额度</span>
                          <span className="text-center">使用率</span>
                          <span className="text-center">查看</span>
                          <span className="text-center">操作</span>
                        </div>

                        {filteredAccounts.map((account) => {
                          const tone = usageTone(account.usagePercent);
                          const isSelected = selectedAccount?.username === account.username;
                          const coolingDown = checkinQueue?.status === "cooldown";
                          const isWorking = workingAccount === account.username;

                          return (
                            <motion.article
                              key={account.username}
                              variants={itemVariants}
                              className={cn(
                                "rounded-[0.96rem] border border-[#E6EFEB] bg-[rgba(255,255,255,0.82)] shadow-[0_6px_16px_rgba(16,42,36,0.04)] transition-colors hover:bg-[#F3FBF7] dark:border-[#263E37] dark:bg-[rgba(19,31,27,0.8)] dark:hover:bg-[#15251F]",
                                isSelected && "border-[#BFE8DA] shadow-[0_10px_18px_rgba(52,199,154,0.12)]"
                              )}
                            >
                              <div className="flex flex-col gap-1.5 px-3 py-2 xl:hidden">
                                <div className="flex items-center justify-between gap-3">
                                  <button
                                    type="button"
                                    className="flex min-w-0 items-center gap-2.5 text-left"
                                    onClick={() => setSelectedUsername(account.username)}
                                  >
                                    <span className="grid h-7.5 w-7.5 shrink-0 place-items-center rounded-full bg-[#34C79A] text-[12px] font-black text-white">
                                      {getAccountInitial(account)}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="truncate text-[13px] font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                        {account.displayName || account.username}
                                      </p>
                                      <div className="mt-1 flex flex-wrap gap-1.5">
                                        {getCheckinBadge(account)}
                                        {getTodayUsedBadge(account.todayUsedStatus)}
                                      </div>
                                    </div>
                                  </button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6.5 px-3 text-[10px]"
                                    onClick={() => setSelectedUsername(account.username)}
                                  >
                                    查看
                                  </Button>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-[10px]">
                                  <div>
                                    <p className="text-[#71867F] dark:text-[#89A39B]">已用</p>
                                    <p className="mt-0.5 font-semibold text-[#102A24] dark:text-[#E7F7F0]">{getTodayUsedText(account)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[#71867F] dark:text-[#89A39B]">总额度</p>
                                    <p className="mt-0.5 font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                      {money(account.totalQuota, account.currencySymbol)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[#71867F] dark:text-[#89A39B]">剩余额度</p>
                                    <p className="mt-0.5 font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                      {money(account.remainingQuota, account.currencySymbol)}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0 flex-1 rounded-[0.9rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.78)] px-3 py-1.5 dark:border-[#294038] dark:bg-[rgba(20,31,27,0.86)]">
                                    <div className="flex items-center justify-between gap-2 text-[10px] text-[#71867F] dark:text-[#89A39B]">
                                      <span>使用率</span>
                                      <span className={cn("font-semibold", tone.text)}>
                                        {percent(account.usagePercent)}
                                      </span>
                                    </div>
                                    <p className="mt-1 truncate text-[10px] text-[#9AABA5] dark:text-[#667B73]">
                                      已用 {money(account.todayUsed ?? 0, account.currencySymbol)}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={account.signedToday ? "secondary" : "default"}
                                    className="h-6.5 px-3 text-[10px]"
                                    disabled={account.signedToday || coolingDown || isWorking}
                                    onClick={() => void handleSingleCheckin(account)}
                                  >
                                    {isWorking ? (
                                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    )}
                                    {getSingleActionLabel(account, isWorking, Boolean(coolingDown))}
                                  </Button>
                                </div>
                              </div>
                              <div
                                className={cn(
                                  "hidden items-center gap-2.5 px-3 py-1.5 text-[10px] text-[#2F4A43] dark:text-[#D8EEE6] xl:grid",
                                  ACCOUNT_TABLE_GRID
                                )}
                              >
                                <button
                                  type="button"
                                  className="flex min-w-0 items-center gap-2.5 text-left"
                                  onClick={() => setSelectedUsername(account.username)}
                                >
                                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#34C79A] text-[12px] font-black text-white">
                                    {getAccountInitial(account)}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-[12px] font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                      {account.displayName || account.username}
                                    </p>
                                    <p className="mt-0.5 truncate text-[9px] text-[#71867F] dark:text-[#89A39B]">
                                      {account.signedToday ? "签到正常且用量当日清" : getAccountQueueHint(account, checkinQueue, usageQueue)}
                                    </p>
                                  </div>
                                </button>
                                <div className="flex justify-center">{getCheckinBadge(account)}</div>
                                <div className="flex justify-center">{getTodayUsedBadge(account.todayUsedStatus)}</div>
                                <div className="text-center font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                  {getTodayUsedText(account)}
                                </div>
                                <div className="text-center font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                  {money(account.totalQuota, account.currencySymbol)}
                                </div>
                                <div className="text-center font-semibold text-[#102A24] dark:text-[#E7F7F0]">
                                  {money(account.remainingQuota, account.currencySymbol)}
                                </div>
                                <div className="min-w-0 text-center">
                                  <span className={cn("block whitespace-nowrap font-semibold", tone.text)}>
                                    {percent(account.usagePercent)}
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 justify-self-center px-3 text-[10px]"
                                  onClick={() => setSelectedUsername(account.username)}
                                >
                                  查看
                                </Button>
                                <Button
                                  size="sm"
                                  variant={account.signedToday ? "secondary" : "default"}
                                  className="h-6 justify-self-center px-3 text-[10px]"
                                  disabled={account.signedToday || coolingDown || isWorking}
                                  onClick={() => void handleSingleCheckin(account)}
                                >
                                  {isWorking ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                  {getSingleActionLabel(account, isWorking, Boolean(coolingDown))}
                                </Button>
                              </div>
                            </motion.article>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center rounded-[1.1rem] border border-dashed border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] p-8 text-center text-sm text-muted-foreground dark:border-[#294038] dark:bg-[rgba(18,28,24,0.82)]">
                      当前筛选条件下没有账号数据。
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.section>
          </section>

          <aside className="flex h-full flex-col gap-2.5 xl:col-span-4">
            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="shrink-0">
                <Card className="border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
                <CardHeader className="pb-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-[1.08rem] text-[#102A24] dark:text-[#E7F7F0]">账号详情</CardTitle>
                      <CardDescription className="mt-1 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                        聚焦当前账号的关键指标，监控状态和同步状态。
                      </CardDescription>
                    </div>
                    <div className="min-w-[126px]">
                      <Select value={selectedAccount?.username ?? ""} onValueChange={setSelectedUsername}>
                        <SelectTrigger className="h-8 rounded-full border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] px-3 text-[11px] shadow-none dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]">
                          <SelectValue placeholder="切换账号" />
                        </SelectTrigger>
                        <SelectContent>
                          {dashboard?.accounts.map((account) => (
                            <SelectItem value={account.username} key={account.username}>
                              {account.displayName || account.username}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {selectedAccount ? (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2.5">
                      <div className="rounded-[1.18rem] border border-white/20 bg-[linear-gradient(135deg,#1E7E63_0%,#22A87F_50%,#2DC495_100%)] p-3.5 text-white shadow-[0_14px_32px_rgba(0,0,0,0.24)] dark:border-white/14">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[rgba(255,255,255,0.94)] text-[1rem] font-black text-[#34C79A]">
                              {getAccountInitial(selectedAccount)}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold tracking-[0.14em] text-white/72">
                                当前焦点账号
                              </p>
                              <h3 className="mt-1 truncate text-[1.34rem] font-black tracking-tight">
                                {selectedAccount.displayName || selectedAccount.username}
                              </h3>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                {getCheckinBadge(selectedAccount)}
                                <span className="text-[11px] text-white/78">{getAccountQueueHint(selectedAccount, checkinQueue, usageQueue)}</span>
                              </div>
                            </div>
                          </div>
                          <Badge className="border-white/24 bg-white/18 text-white">
                            {getCheckinStatusText(selectedAccount)}
                          </Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {selectedAccountMetrics.map((metric) => (
                            <div
                              key={metric.label}
                              className="rounded-[0.95rem] border border-white/30 bg-[rgba(255,255,255,0.18)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                            >
                              <p className="text-[11px] text-white/74">{metric.label}</p>
                              <p className="mt-1 text-[0.96rem] font-black">{metric.value}</p>
                              <p className="mt-1 text-[10px] text-white/70">{metric.hint}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3">
                          <div className="flex items-center justify-between gap-3 text-[11px] text-white/82">
                            <span>使用率进度</span>
                            <span>{percent(selectedAccount.usagePercent)}</span>
                          </div>
                          <Progress
                            value={selectedAccount.usagePercent}
                            indicatorClassName={selectedUsageTone.bar}
                            className="mt-1.5 h-2 bg-white/18"
                          />
                        </div>
                      </div>

                      <div className="grid auto-rows-fr gap-2 sm:grid-cols-2">
                        {selectedAccountCoreFields.map((field) => {
                          const Icon = field.icon;
                          return (
                            <div
                              key={field.label}
                              className="min-h-[94px] rounded-[0.96rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.84)] px-3.5 py-2.5 shadow-[0_10px_18px_rgba(16,42,36,0.05)] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)] dark:shadow-[0_12px_18px_rgba(0,0,0,0.22)]"
                            >
                              <div className="flex h-full min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] text-[#71867F] dark:text-[#89A39B]">{field.label}</p>
                                  <p className="mt-1 break-words text-[0.95rem] font-semibold leading-snug text-[#102A24] dark:text-[#E7F7F0]">
                                    {field.value}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#9AABA5] dark:text-[#667B73]">
                                    {field.hint}
                                  </p>
                                </div>
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#BDEDDD] bg-[#ECFBF6] text-[#34C79A] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                                  <Icon className="h-4 w-4" />
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6.5 rounded-full px-3 text-[10px]"
                          onClick={() => setDetailExpanded((value) => !value)}
                        >
                          {detailExpanded ? "收起更多详情" : "更多详情"}
                        </Button>
                        <Button
                          size="sm"
                          className="h-6.5 px-3 text-[10px]"
                          disabled={
                            selectedAccount.signedToday ||
                            checkinQueue?.status === "cooldown" ||
                            workingAccount === selectedAccount.username
                          }
                          onClick={() => void handleSingleCheckin(selectedAccount)}
                        >
                          {workingAccount === selectedAccount.username ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          {getSingleActionLabel(
                            selectedAccount,
                            workingAccount === selectedAccount.username,
                            checkinQueue?.status === "cooldown"
                          )}
                        </Button>
                      </div>

                      {detailExpanded ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {selectedAccountExtraFields.map((field) => (
                            <QueueMetaCell key={field.label} label={field.label} value={field.value} />
                          ))}
                        </div>
                      ) : null}
                    </motion.div>
                  ) : (
                    <div className="rounded-[1.1rem] border border-dashed border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] p-8 text-center text-sm text-muted-foreground dark:border-[#294038] dark:bg-[rgba(18,28,24,0.82)]">
                      选择账号后显示详情。
                    </div>
                  )}
                </CardContent>
                </Card>
            </motion.section>

            <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1">
              <Card className="flex h-full min-h-[252px] flex-col border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
                <CardHeader className="pb-2.5">
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <CardTitle className="text-[1.08rem] text-[#102A24] dark:text-[#E7F7F0]">数据分析</CardTitle>
                        <CardDescription className="mt-1 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                          对比总账号今日已用与剩余额度，默认只展示一个紧凑图表。
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="px-3 py-1 text-[11px]">
                        最近 {trendData.length || comparisonData.length} 条数据
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-full border border-[#DDEAE5] bg-[rgba(255,255,255,0.62)] p-1 dark:border-[#294038] dark:bg-[rgba(20,31,27,0.82)]">
                      {ANALYSIS_TABS.map((tab) => (
                        <Button
                          key={tab.key}
                          size="sm"
                          variant={analysisTab === tab.key ? "default" : "ghost"}
                          className={cn(
                            "h-7 rounded-full px-3 text-[11px] shadow-none",
                            analysisTab === tab.key
                              ? "bg-[linear-gradient(135deg,#34C79A,#22B889)] text-white shadow-[0_6px_16px_rgba(52,199,154,0.22)]"
                              : "text-[#71867F]"
                          )}
                          onClick={() => setAnalysisTab(tab.key)}
                        >
                          {tab.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col pt-0">
                  <div className="mb-1.5 flex items-center justify-end gap-4 text-[10px] text-[#71867F] dark:text-[#89A39B]">
                    {analysisTab === "comparison" ? (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#34C79A]" />
                          今日已用
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: chartRemainingColor }}
                          />
                          剩余额度
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#34C79A]" />
                        {analysisMeta.label}
                      </span>
                    )}
                  </div>
                  <div className="min-h-[260px] flex-1 rounded-[1.08rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] p-2 dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)]">
                    {analysisTab === "comparison" ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparisonData} barGap={8} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={chartGridStroke} strokeOpacity={1} vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;

                              const todayUsedValue = Number(
                                payload.find((item) => item.dataKey === "todayUsed")?.value ?? 0
                              );
                              const remainingQuotaValue = Number(
                                payload.find((item) => item.dataKey === "remainingQuota")?.value ?? 0
                              );

                              return (
                                <div
                                  style={chartTooltipStyle}
                                  className="min-w-[176px] rounded-[14px] px-4 py-3 shadow-[0_18px_40px_rgba(16,42,36,0.14)]"
                                >
                                  <p className="text-sm font-semibold" style={{ color: chartTooltipTitleColor }}>
                                    {label}
                                  </p>
                                  <div className="mt-2.5 space-y-1.5">
                                    <div
                                      className="flex items-center justify-between gap-4 text-sm font-semibold"
                                      style={{ color: chartTooltipValueColor }}
                                    >
                                      <span>今日已用</span>
                                      <span>{money(todayUsedValue, currencySymbol)}</span>
                                    </div>
                                    <div
                                      className="flex items-center justify-between gap-4 text-sm font-semibold"
                                      style={{ color: chartTooltipValueColor }}
                                    >
                                      <span>剩余额度</span>
                                      <span>{money(remainingQuotaValue, currencySymbol)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="todayUsed" name="今日已用" fill={chartUsedColor} radius={[6, 6, 0, 0]} maxBarSize={20} />
                          <Bar dataKey="remainingQuota" name="剩余额度" fill={chartRemainingColor} radius={[6, 6, 0, 0]} maxBarSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : null}

                    {analysisTab === "checkinTrend" ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={chartGridStroke} strokeOpacity={1} vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip
                            formatter={(value) => money(Number(value ?? 0), currencySymbol)}
                            contentStyle={chartTooltipStyle}
                          />
                          <Line
                            type="monotone"
                            dataKey="checkinIncome"
                            name="签到收益"
                            stroke="#34C79A"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: "#34C79A" }}
                            activeDot={{ r: 4.5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : null}

                    {analysisTab === "usageTrend" ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid stroke={chartGridStroke} strokeOpacity={1} vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip
                            formatter={(value) => money(Number(value ?? 0), currencySymbol)}
                            contentStyle={chartTooltipStyle}
                          />
                          <Line
                            type="monotone"
                            dataKey="usedQuota"
                            name="已用额度"
                            stroke="#34C79A"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: "#34C79A" }}
                            activeDot={{ r: 4.5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </motion.section>
          </aside>
        </div>
      </div>

      <AccountImportModal
        isOpen={importModalOpen}
        accountFile={dashboard?.accountFile}
        onClose={() => setImportModalOpen(false)}
        onSuccess={handleImportSuccess}
        onNotice={setNotice}
      />

      <AnimatePresence>
        {refreshToast ? (
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-none fixed inset-x-0 top-5 z-[80] flex justify-center px-4"
          >
            <div
              className={cn(
                "flex min-w-[280px] max-w-[min(92vw,420px)] items-center gap-3 rounded-[1.2rem] border px-4 py-3 shadow-[0_18px_40px_rgba(16,42,36,0.16)] backdrop-blur-md",
                refreshToast.tone === "success"
                  ? "border-[#BDEDDD] bg-[rgba(240,252,247,0.96)] text-[#0E5C47]"
                  : "border-[#F4C5C5] bg-[rgba(255,246,246,0.96)] text-[#9B2C2C]"
              )}
            >
              {refreshToast.tone === "success" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[#12A57E]" />
              ) : (
                <AlertTriangle className="h-5 w-5 shrink-0 text-[#D55C5C]" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {refreshToast.tone === "success" ? "刷新完成" : "刷新失败"}
                </p>
                <p className="mt-0.5 text-xs text-current/80">{refreshToast.message}</p>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
