import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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
  Database,
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
import { ApiError, checkinAccount, checkinAll, getQuotaMonitor } from "@/services/api";
import type {
  AccountQuota,
  CheckinQueueState,
  CheckinScope,
  QuotaDashboard,
  QueueLifecycleStatus,
  TodayUsedStatus,
  UsageSyncState
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

function money(value: number | null | undefined, symbol = "楼") {
  if (value == null) return "待同步";
  return `${symbol}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function percent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatTime(value?: string | null) {
  if (!value) return "未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatCountdown(value?: string | null, now = Date.now()) {
  if (!value) return null;
  const diff = new Date(value).getTime() - now;
  if (diff <= 0) return "00:00";
  const totalSeconds = Math.ceil(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function usageTone(value: number) {
  if (value > 100) {
    return {
      bar: "bg-red-500",
      text: "text-red-600 dark:text-red-300",
      badge: "destructive" as const
    };
  }
  if (value >= 80) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-300",
      badge: "warning" as const
    };
  }
  return {
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-300",
    badge: "success" as const
  };
}

function getQueueVariant(status?: QueueLifecycleStatus) {
  if (status === "cooldown") return "warning" as const;
  if (status === "running") return "default" as const;
  if (status === "completed") return "success" as const;
  if (status === "paused") return "outline" as const;
  return "secondary" as const;
}

function getQueueLabel(status?: QueueLifecycleStatus) {
  switch (status) {
    case "running":
      return "进行中";
    case "cooldown":
      return "冷却中";
    case "completed":
      return "已完成";
    case "paused":
      return "已暂停";
    default:
      return "空闲";
  }
}

function getCheckinBadge(account: AccountQuota) {
  if (account.signedToday) return <Badge variant="success">今日已签到</Badge>;
  if (account.checkinStatus === "failed") return <Badge variant="destructive">签到异常</Badge>;
  if (account.checkinStatus === "unknown") return <Badge variant="outline">状态待同步</Badge>;
  return <Badge variant="warning">未签到</Badge>;
}

function getTodayUsedBadge(status: TodayUsedStatus) {
  switch (status) {
    case "exact":
      return <Badge variant="success">精确</Badge>;
    case "stale":
      return <Badge variant="outline">缓存</Badge>;
    case "unavailable":
      return <Badge variant="destructive">不可用</Badge>;
    default:
      return <Badge variant="warning">待同步</Badge>;
  }
}

function getTodayUsedText(account: AccountQuota) {
  if (account.todayUsedStatus === "pending") return "待同步";
  if (account.todayUsedStatus === "unavailable" && account.todayUsed == null) return "不可用";
  return money(account.todayUsed, account.currencySymbol);
}

function getUsageSourceText(account: AccountQuota) {
  switch (account.todayUsedStatus) {
    case "exact":
      return "日志统计精确值";
    case "stale":
      return "本地缓存值";
    case "unavailable":
      return "接口不可用";
    default:
      return "后台待同步";
  }
}

function getCheckinSourceText(account: AccountQuota) {
  return account.dataSource?.checkin === "remote" ? "远程确认" : "本地缓存";
}

function getCheckinActionLabel(queue: CheckinQueueState | undefined, pending = false) {
  if (!queue || queue.status === "idle" || queue.status === "completed") {
    return pending ? "启动中..." : "开始签到";
  }
  if (queue.status === "cooldown") {
    return "冷却中";
  }
  if (queue.status === "paused") {
    return pending ? "恢复中..." : "继续签到";
  }
  return pending ? "启动中..." : "继续签到";
}

function getSingleActionLabel(account: AccountQuota, working: boolean, coolingDown: boolean) {
  if (account.signedToday) return "今日已签到";
  if (coolingDown) return "冷却中";
  return working ? "签到中..." : "立即签到";
}

function matchesFilter(account: AccountQuota, filter: AccountFilter) {
  switch (filter) {
    case "checked":
      return account.signedToday;
    case "pending":
      return (
        account.todayUsedStatus === "pending" ||
        account.checkinStatus === "unknown" ||
        account.todayUsedStatus === "stale"
      );
    case "error":
      return account.checkinStatus === "failed" || account.todayUsedStatus === "unavailable";
    case "unchecked":
      return !account.signedToday;
    default:
      return true;
  }
}

function getAccountQueueHint(
  account: AccountQuota,
  checkinQueue: CheckinQueueState | undefined,
  usageQueue: UsageSyncState | undefined
) {
  if (checkinQueue?.currentUsername === account.username) return "当前正在签到";
  if (usageQueue?.currentUsername === account.username) return "当前正在同步当日用量";
  if (checkinQueue?.status === "cooldown") return "签到队列冷却中";
  if (checkinQueue?.status === "running" && !account.signedToday) return "等待签到队列处理";
  if (usageQueue?.status === "running" && account.todayUsedStatus !== "exact") return "等待同步当日用量";
  return "当前无排队任务";
}

function describeCheckinQueue(queue: CheckinQueueState | undefined, countdown: string | null) {
  if (!queue) return "等待开始";
  const handled = queue.progress.completed + queue.progress.failed + queue.progress.skipped;

  switch (queue.status) {
    case "running":
      return `签到进行中，已处理 ${handled}/${queue.progress.total}`;
    case "cooldown":
      return countdown ? `触发限流冷却，${countdown} 后自动继续` : "触发限流冷却";
    case "completed":
      return `签到完成，成功 ${queue.progress.completed}，跳过 ${queue.progress.skipped}，失败 ${queue.progress.failed}`;
    case "paused":
      return "签到队列已暂停，可继续执行";
    default:
      return "等待开始";
  }
}

function describeUsageQueue(queue: UsageSyncState | undefined, countdown: string | null) {
  if (!queue) return "等待同步";

  switch (queue.status) {
    case "running":
      return `后台同步中，已完成 ${queue.progress.completed}/${queue.progress.total}`;
    case "cooldown":
      return countdown ? `统计同步冷却中，${countdown} 后自动恢复` : "统计同步冷却中";
    case "completed":
      return "当日用量同步完成";
    case "paused":
      return "统计同步已暂停，等待下轮继续";
    default:
      return "等待同步";
  }
}

export default function QuotaMonitorPage() {
  const [dashboard, setDashboard] = useState<QuotaDashboard | null>(null);
  const [selectedUsername, setSelectedUsername] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workingAccount, setWorkingAccount] = useState<string | null>(null);
  const [workingScope, setWorkingScope] = useState<CheckinScope | null>(null);
  const [notice, setNotice] = useState("");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("cw-theme") === "dark");
  const [now, setNow] = useState(Date.now());
  const selectedRef = useRef("");

  async function loadDashboard(options: {
    silent?: boolean;
    force?: boolean;
    selected?: string | null;
    signal?: AbortSignal;
  } = {}) {
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
      setNotice(data.errors[0] ?? "");
      setSelectedUsername((current) => {
        if (current && data.accounts.some((account) => account.username === current)) {
          return current;
        }
        return data.accounts[0]?.username ?? "";
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "网络异常，请检查服务是否正常启动";
      setNotice(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    selectedRef.current = selectedUsername;
  }, [selectedUsername]);

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
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
  const usageQueue = dashboard?.sync.usageSync;
  const cooldownCountdown = formatCountdown(checkinQueue?.cooldownUntil, now);
  const usageCountdown = formatCountdown(usageQueue?.cooldownUntil, now);
  const failedAccountsCount = checkinQueue?.progress.failed ?? 0;

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
      const queue = result.sync.checkinQueue;
      setNotice(
        scope === "failed"
          ? `失败账号重试队列已启动，当前进度 ${queue.progress.completed + queue.progress.skipped}/${queue.progress.total}`
          : `签到队列已启动，当前进度 ${queue.progress.completed + queue.progress.skipped}/${queue.progress.total}`
      );
      await loadDashboard({ silent: true, force: true, selected: selectedUsername || null });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "站点限流，请稍后重试"
          : error instanceof Error
            ? error.message
            : "批量签到失败";
      setNotice(message);
    } finally {
      setWorkingScope(null);
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

  const comparisonData =
    dashboard?.accounts.map((account) => ({
      name: account.displayName || account.username,
      todayUsed: account.todayUsed ?? 0,
      remainingQuota: account.remainingQuota,
      balance: account.balance
    })) ?? [];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-8rem] h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute right-[-12rem] top-16 h-96 w-96 rounded-full bg-primary/16 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-1/3 h-96 w-96 rounded-full bg-secondary/60 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <motion.header
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 rounded-[1.6rem] border border-border/70 bg-card/78 p-4 shadow-[0_20px_80px_hsl(var(--foreground)/0.08)] backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between"
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                <Zap className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.36em] text-muted-foreground">
                  CW-OPS ACCOUNT OPERATIONS
                </p>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                  CW-Ops 账户管理系统
                </h1>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              将签到快路径、限流冷却和当日精确用量同步放进同一块运维看板里。
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
            <div className="min-w-[220px]">
              <Select value={selectedAccount?.username ?? ""} onValueChange={setSelectedUsername}>
                <SelectTrigger>
                  <SelectValue placeholder="选择账号" />
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

            <motion.div whileTap={{ scale: 0.96 }}>
              <Button variant="outline" onClick={() => setDarkMode((value) => !value)}>
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                主题切换
              </Button>
            </motion.div>

            <motion.div whileTap={{ scale: 0.96 }}>
              <Button
                variant="outline"
                onClick={() =>
                  void loadDashboard({
                    silent: true,
                    force: true,
                    selected: selectedUsername || null
                  })
                }
                disabled={refreshing}
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                刷新
              </Button>
            </motion.div>

            <motion.div whileTap={{ scale: 0.96 }}>
              <Button
                onClick={() => void handleCheckinAll("all")}
                disabled={
                  !dashboard?.accounts.length ||
                  workingScope !== null ||
                  checkinQueue?.status === "cooldown"
                }
              >
                {workingScope === "all" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {getCheckinActionLabel(checkinQueue, workingScope === "all")}
              </Button>
            </motion.div>
          </div>
        </motion.header>

        <section className="grid gap-4 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>签到队列进度</CardTitle>
                    <CardDescription>
                      当前账号：{checkinQueue?.currentUsername || "暂无"}
                    </CardDescription>
                  </div>
                  <Badge variant={getQueueVariant(checkinQueue?.status)}>
                    {getQueueLabel(checkinQueue?.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    完成 {checkinQueue?.progress.completed ?? 0}，跳过{" "}
                    {checkinQueue?.progress.skipped ?? 0}，失败 {checkinQueue?.progress.failed ?? 0}
                  </span>
                  <span className="font-semibold">
                    {(checkinQueue?.progress.completed ?? 0) +
                      (checkinQueue?.progress.skipped ?? 0)}
                    /{checkinQueue?.progress.total ?? 0}
                  </span>
                </div>
                <Progress
                  value={
                    !checkinQueue?.progress.total
                      ? 0
                      : (((checkinQueue.progress.completed + checkinQueue.progress.skipped) /
                          checkinQueue.progress.total) *
                          100)
                  }
                  indicatorClassName="bg-primary"
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{describeCheckinQueue(checkinQueue, cooldownCountdown)}</span>
                  {cooldownCountdown && checkinQueue?.status === "cooldown" ? (
                    <Badge variant="warning">冷却倒计时 {cooldownCountdown}</Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>当日用量同步</CardTitle>
                    <CardDescription>
                      当前账号：{usageQueue?.currentUsername || "暂无"}
                    </CardDescription>
                  </div>
                  <Badge variant={getQueueVariant(usageQueue?.status)}>
                    {getQueueLabel(usageQueue?.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    已同步 {dashboard?.summary.todayUsedCoverage.exactOrStaleAccounts ?? 0}/
                    {dashboard?.summary.todayUsedCoverage.totalAccounts ?? 0}
                  </span>
                  <span className="font-semibold">
                    {usageQueue?.progress.completed ?? 0}/{usageQueue?.progress.total ?? 0}
                  </span>
                </div>
                <Progress
                  value={
                    !usageQueue?.progress.total
                      ? 0
                      : (usageQueue.progress.completed / usageQueue.progress.total) * 100
                  }
                  indicatorClassName="bg-accent"
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{describeUsageQueue(usageQueue, usageCountdown)}</span>
                  {usageCountdown && usageQueue?.status === "cooldown" ? (
                    <Badge variant="warning">冷却倒计时 {usageCountdown}</Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {notice ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card/75 px-4 py-3 text-sm text-muted-foreground backdrop-blur-xl"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 text-accent" />
            <span>{notice}</span>
          </motion.div>
        ) : null}

        <motion.section
          variants={listVariants}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <motion.div variants={itemVariants} whileHover={{ y: -4 }} key={card.title}>
                <Card className="h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">{card.title}</p>
                        <p className="mt-3 text-2xl font-black tracking-tight">{card.value}</p>
                      </div>
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    <p className="mt-5 text-xs text-muted-foreground">{card.hint}</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_560px] 2xl:grid-cols-[minmax(0,1fr)_640px]">
          <section className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <CardTitle>多账号列表</CardTitle>
                    <CardDescription>
                      按签到状态、同步状态和异常情况筛选账号。
                    </CardDescription>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {FILTERS.map((item) => (
                      <Button
                        key={item.key}
                        size="sm"
                        variant={filter === item.key ? "default" : "outline"}
                        onClick={() => setFilter(item.key)}
                      >
                        {item.label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCheckinAll("failed")}
                      disabled={
                        failedAccountsCount === 0 ||
                        workingScope !== null ||
                        checkinQueue?.status === "cooldown"
                      }
                    >
                      <RotateCcw className="h-4 w-4" />
                      仅重试失败账号
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {loading ? (
                  <div className="grid gap-3">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div
                        className="h-28 animate-pulse rounded-2xl bg-muted/70"
                        key={`loading-${index}`}
                      />
                    ))}
                  </div>
                ) : filteredAccounts.length ? (
                  <motion.div variants={listVariants} initial="hidden" animate="show" className="grid gap-3">
                    {filteredAccounts.map((account) => {
                      const tone = usageTone(account.usagePercent);
                      const isSelected = selectedAccount?.username === account.username;
                      const coolingDown = checkinQueue?.status === "cooldown";
                      const isWorking = workingAccount === account.username;

                      return (
                        <motion.article
                          variants={itemVariants}
                          whileHover={{ scale: 1.006 }}
                          key={account.username}
                          className={cn(
                            "rounded-2xl border bg-background/55 p-4 transition",
                            isSelected
                              ? "border-primary/60 shadow-[0_16px_55px_hsl(var(--primary)/0.15)]"
                              : "border-border/80"
                          )}
                        >
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                            <button
                              type="button"
                              className="min-w-0 text-left"
                              onClick={() => setSelectedUsername(account.username)}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-base font-bold">
                                  {account.displayName || account.username}
                                </h3>
                                {getCheckinBadge(account)}
                                {getTodayUsedBadge(account.todayUsedStatus)}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {getAccountQueueHint(account, checkinQueue, usageQueue)}
                              </p>
                            </button>

                            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:min-w-[520px]">
                              <div>
                                <p className="text-xs text-muted-foreground">今日已用</p>
                                <p className="mt-1 font-semibold">{getTodayUsedText(account)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">总额度</p>
                                <p className="mt-1 font-semibold">
                                  {money(account.totalQuota, account.currencySymbol)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">剩余额度</p>
                                <p className="mt-1 font-semibold">
                                  {money(account.remainingQuota, account.currencySymbol)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">当前余额</p>
                                <p className="mt-1 font-semibold">
                                  {money(account.balance, account.currencySymbol)}
                                </p>
                              </div>
                            </div>

                            <motion.div whileTap={{ scale: 0.96 }}>
                              <Button
                                size="sm"
                                variant={account.signedToday ? "secondary" : "default"}
                                disabled={account.signedToday || coolingDown || isWorking}
                                onClick={() => void handleSingleCheckin(account)}
                              >
                                {isWorking ? (
                                  <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                {getSingleActionLabel(account, isWorking, Boolean(coolingDown))}
                              </Button>
                            </motion.div>
                          </div>

                          <div className="mt-4 grid gap-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className={cn("font-semibold", tone.text)}>
                                使用率 {percent(account.usagePercent)}
                              </span>
                              <span className="text-muted-foreground">
                                {account.todayUsed == null
                                  ? "待同步 / 未覆盖"
                                  : `${money(account.todayUsed, account.currencySymbol)} / ${money(account.totalQuota, account.currencySymbol)}`}
                              </span>
                            </div>
                            <Progress value={account.usagePercent} indicatorClassName={tone.bar} />
                          </div>
                        </motion.article>
                      );
                    })}
                  </motion.div>
                ) : (
                  <div className="rounded-2xl border border-dashed bg-background/45 p-8 text-center text-sm text-muted-foreground">
                    当前筛选条件下没有账号数据。
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <aside className="flex flex-col gap-6 xl:sticky xl:top-5 xl:self-start">
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>账号详情</CardTitle>
                    <CardDescription>查看选中账号的签到来源、用量同步和队列状态。</CardDescription>
                  </div>
                  <Clock3 className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {selectedAccount ? (
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="rounded-3xl bg-primary p-5 text-primary-foreground">
                      <p className="text-sm opacity-80">当前账号</p>
                      <h2 className="mt-2 break-all text-2xl font-black">
                        {selectedAccount.displayName || selectedAccount.username}
                      </h2>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {getCheckinBadge(selectedAccount)}
                        {getTodayUsedBadge(selectedAccount.todayUsedStatus)}
                        <Badge variant={usageTone(selectedAccount.usagePercent).badge}>
                          {percent(selectedAccount.usagePercent)}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span>额度使用率</span>
                          <strong>{percent(selectedAccount.usagePercent)}</strong>
                        </div>
                        <Progress
                          value={selectedAccount.usagePercent}
                          indicatorClassName={usageTone(selectedAccount.usagePercent).bar}
                        />
                      </div>

                      <dl className="grid gap-3 text-sm">
                        <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                          <dt className="text-muted-foreground">最近签到收益</dt>
                          <dd className="font-bold">
                            {money(selectedAccount.lastCheckinReward, selectedAccount.currencySymbol)}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                          <dt className="text-muted-foreground">签到状态来源</dt>
                          <dd className="font-bold">{getCheckinSourceText(selectedAccount)}</dd>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                          <dt className="text-muted-foreground">当日用量来源</dt>
                          <dd className="font-bold">{getUsageSourceText(selectedAccount)}</dd>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                          <dt className="text-muted-foreground">当日用量更新时间</dt>
                          <dd className="font-bold">{formatTime(selectedAccount.todayUsedUpdatedAt)}</dd>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                          <dt className="text-muted-foreground">刷新时间</dt>
                          <dd className="font-bold">{formatTime(selectedAccount.updatedAt)}</dd>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                          <dt className="text-muted-foreground">排队状态</dt>
                          <dd className="font-bold">
                            {getAccountQueueHint(selectedAccount, checkinQueue, usageQueue)}
                          </dd>
                        </div>
                        {cooldownCountdown && checkinQueue?.status === "cooldown" ? (
                          <div className="flex items-center justify-between rounded-2xl bg-background/55 px-4 py-3">
                            <dt className="text-muted-foreground">冷却倒计时</dt>
                            <dd className="font-bold text-amber-600 dark:text-amber-300">
                              {cooldownCountdown}
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      <motion.div whileTap={{ scale: 0.96 }}>
                        <Button
                          className="w-full"
                          disabled={
                            selectedAccount.signedToday ||
                            checkinQueue?.status === "cooldown" ||
                            workingAccount === selectedAccount.username
                          }
                          onClick={() => void handleSingleCheckin(selectedAccount)}
                        >
                          {workingAccount === selectedAccount.username ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {getSingleActionLabel(
                            selectedAccount,
                            workingAccount === selectedAccount.username,
                            checkinQueue?.status === "cooldown"
                          )}
                        </Button>
                      </motion.div>
                    </div>
                  </motion.div>
                ) : (
                  <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    选择账号后显示详情。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>账号额度对比</CardTitle>
                <CardDescription>对比每个账号的今日已用、剩余额度和主余额。</CardDescription>
              </CardHeader>
              <CardContent className="h-[330px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => money(Number(value ?? 0), currencySymbol)}
                      contentStyle={{
                        borderRadius: "16px",
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--popover))"
                      }}
                    />
                    <Bar dataKey="todayUsed" name="今日已用" fill="hsl(var(--accent))" radius={[10, 10, 0, 0]} />
                    <Bar
                      dataKey="remainingQuota"
                      name="剩余额度"
                      fill="hsl(var(--primary))"
                      radius={[10, 10, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>签到趋势图</CardTitle>
                <CardDescription>展示最近 7 天签到收益和今日同步到的用量。</CardDescription>
              </CardHeader>
              <CardContent className="h-[330px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard?.trend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => money(Number(value ?? 0), currencySymbol)}
                      contentStyle={{
                        borderRadius: "16px",
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--popover))"
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="checkinIncome"
                      name="签到收益"
                      stroke="hsl(var(--primary))"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="usedQuota"
                      name="已用额度"
                      stroke="hsl(var(--accent))"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>运维建议</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3 rounded-2xl bg-background/55 px-4 py-3">
                  <Database className="mt-0.5 h-4 w-4 text-primary" />
                  <span>下一步建议补上历史批次记录，便于看出哪些账号最容易触发限流。</span>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-background/55 px-4 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-accent" />
                  <span>可以继续增加账号分组与优先级，让高频账号优先签到和优先同步。</span>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-background/55 px-4 py-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
                  <span>建议后续加入连续 429、登录失效和同步超时的明显告警条。</span>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
