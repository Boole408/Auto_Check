import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileUp,
  LoaderCircle,
  LogOut,
  Moon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Zap
} from "lucide-react";
import { AccountImportModal } from "@/components/AccountImportModal";
import { CountdownTimer } from "@/components/CountdownTimer";
import { AccountDetailPanel } from "@/features/quota-monitor/components/AccountDetailPanel";
import { AccountListPanel } from "@/features/quota-monitor/components/AccountListPanel";
import { OverviewPanel } from "@/features/quota-monitor/components/OverviewPanel";
import { type AccountFilter } from "@/features/quota-monitor/components/shared";
import {
  QuotaMonitorActionProvider,
  useQuotaMonitorActions
} from "@/features/quota-monitor/context/QuotaMonitorActionContext";
import {
  useForceRefreshQuota,
  useQuotaData,
  useQuotaProviders
} from "@/features/quota-monitor/hooks/useQuotaData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  getCheckinActionLabel,
  matchesFilter,
  normalizeUsageQueue
} from "@/lib/formatters";
import { ApiError } from "@/lib/axios";
import type {
  CheckinQueueState,
  DashboardAlert,
  ImportAccountsResult
} from "@/types";
import { cn } from "@/lib/utils";

type RefreshToast = {
  tone: "success" | "error";
  message: string;
} | null;

const LazyQuotaAnalysisPanel = lazy(async () => {
  const module = await import("@/features/quota-monitor/components/QuotaAnalysisPanel");
  return { default: module.QuotaAnalysisPanel };
});

interface QuotaMonitorPageProps {
  currentUser?: string;
  isLoggingOut?: boolean;
  onLogout?: () => Promise<void> | void;
}

function getAlertPresentation(alert: DashboardAlert) {
  switch (alert.type) {
    case "auth_failed":
      return {
        Icon: ShieldAlert,
        badgeVariant: "destructive" as const
      };
    case "sync_timeout":
      return {
        Icon: Clock3,
        badgeVariant: "warning" as const
      };
    default:
      return {
        Icon: AlertTriangle,
        badgeVariant: "warning" as const
      };
  }
}

function CheckinAllActionButton({
  hasAccounts,
  checkinQueue
}: {
  hasAccounts: boolean;
  checkinQueue: CheckinQueueState | undefined;
}) {
  const { handleCheckinAll, workingScope } = useQuotaMonitorActions();
  const bulkCheckinBusy = workingScope === "all" || checkinQueue?.status === "running";

  return (
    <Button
      className="h-9 bg-[linear-gradient(135deg,#34C79A,#22B889)] px-4 text-xs text-white shadow-[0_8px_20px_rgba(52,199,154,0.28)]"
      onClick={() => void handleCheckinAll("all")}
      disabled={
        !hasAccounts ||
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
  );
}

function AnalysisPanelFallback() {
  return (
    <div className="flex min-h-[252px] items-center justify-center rounded-[1.2rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] text-sm text-muted-foreground shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
      正在加载图表分析...
    </div>
  );
}

export default function QuotaMonitorPage({
  currentUser = "admin",
  isLoggingOut = false,
  onLogout
}: QuotaMonitorPageProps) {
  const MANUAL_REFRESH_MIN_SPIN_MS = 850;
  const [selectedProvider, setSelectedProvider] = useState("muyuan");
  const [selectedUsername, setSelectedUsername] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshToast, setRefreshToast] = useState<RefreshToast>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("cw-theme") === "dark");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const {
    data: providerConfig
  } = useQuotaProviders();
  const providers = providerConfig?.providers ?? [
    { id: "muyuan", label: "MUYUAN", baseUrl: "" },
    { id: "xem8k5", label: "XEM8K5", baseUrl: "" },
    { id: "dgbmc", label: "DGBMC", baseUrl: "" },
    { id: "jiuuij", label: "JIUUIJ", displayName: "JIUUIJ", baseUrl: "" },
    { id: "anyrouter", label: "ANYROUTER", displayName: "Any Router", baseUrl: "" }
  ];
  const {
    data: dashboard,
    error: quotaError,
    isLoading: loading,
    isFetching: refreshing,
    refetch: refetchQuotaData
  } = useQuotaData(selectedProvider, selectedUsername);
  const {
    mutateAsync: forceRefreshQuota,
    isPending: isForceRefreshPending
  } = useForceRefreshQuota(selectedProvider, selectedUsername);

  const handleProviderChange = useCallback((provider: string) => {
    setSelectedProvider(provider);
    setSelectedUsername("");
    setFilter("all");
    setNotice("");
  }, []);

  useEffect(() => {
    if (quotaError instanceof ApiError) {
      setNotice(quotaError.message);
      return;
    }

    if (quotaError instanceof Error) {
      setNotice(quotaError.message || "网络异常，请检查服务是否正常启动");
    }
  }, [quotaError]);

  useEffect(() => {
    if (!dashboard) return;
    if (dashboard.provider?.id && dashboard.provider.id !== selectedProvider) return;

    if (dashboard.accounts.length === 0) {
      if (selectedUsername) {
        setSelectedUsername("");
      }
      return;
    }

    if (!selectedUsername || !dashboard.accounts.some((account) => account.username === selectedUsername)) {
      setSelectedUsername(dashboard.accounts[0]?.username ?? "");
    }
  }, [dashboard, selectedProvider, selectedUsername]);

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

  const filteredAccounts = useMemo(
    () => (dashboard?.accounts ?? []).filter((account) => matchesFilter(account, filter)),
    [dashboard?.accounts, filter]
  );
  const checkinQueue = dashboard?.sync.checkinQueue;
  const usageQueue = useMemo(
    () => normalizeUsageQueue(dashboard?.sync.usageSync),
    [dashboard?.sync.usageSync]
  );
  const activeAlerts = dashboard?.alerts ?? [];
  const isRefreshBusy = manualRefreshing || refreshing || isForceRefreshPending;

  const handleImportSuccess = useCallback(
    async (result: ImportAccountsResult) => {
      setNotice(
        result.mode === "merge" && result.importedCount != null
          ? `已合并导入 ${result.importedCount} 个账号，当前共 ${result.count} 个账号`
          : `已导入 ${result.count} 个账号`
      );
      await refetchQuotaData();
    },
    [refetchQuotaData]
  );

  const handleRefresh = useCallback(async () => {
    if (manualRefreshing || refreshing || isForceRefreshPending) return;

    const startedAt = Date.now();
    setManualRefreshing(true);
    setRefreshToast(null);

    try {
      await forceRefreshQuota();

      const elapsed = Date.now() - startedAt;
      if (elapsed < MANUAL_REFRESH_MIN_SPIN_MS) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, MANUAL_REFRESH_MIN_SPIN_MS - elapsed)
        );
      }

      setNotice("数据刷新成功，面板已同步最新状态");
      setRefreshToast({
        tone: "success",
        message: "刷新成功，页面已更新到最新数据。"
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "刷新失败，请稍后重试";
      setNotice(message);
      setRefreshToast({
        tone: "error",
        message: "刷新失败，请查看顶部提示后重试。"
      });
    } finally {
      setManualRefreshing(false);
    }
  }, [forceRefreshQuota, isForceRefreshPending, manualRefreshing, refreshing]);

  const condensedAlerts = useMemo<
    Array<{
      key: string;
      label: string;
      value: ReactNode;
      variant: "outline" | "warning" | "destructive";
    }>
  >(
    () => [
      ...(notice
        ? [{ key: "notice", label: "系统提示", value: notice, variant: "outline" as const }]
        : []),
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
    ],
    [notice, activeAlerts, checkinQueue, usageQueue]
  );

  return (
    <QuotaMonitorActionProvider provider={selectedProvider} onNotice={setNotice}>
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
                    AutoCheck 账户管理系统
                  </h1>
                  <p className="mt-0.5 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                    聚焦监测、用量同步和多账号数据统筹，保障额度与生产能力可视可控。
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="flex h-9 items-center gap-2 rounded-full border border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-3 text-xs font-medium text-[#2F4A43] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]">
                <ShieldCheck className="h-4 w-4 text-[#20A77F]" />
                <span>{currentUser}</span>
              </div>

              <div className="min-w-[144px]">
                <Select value={selectedProvider} onValueChange={handleProviderChange}>
                  <SelectTrigger className="h-9 rounded-full border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 text-left text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]">
                    <SelectValue placeholder="Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.label || provider.id}
                      </SelectItem>
                    ))}
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

              {onLogout ? (
                <Button
                  variant="outline"
                  className="h-9 border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]"
                  onClick={() => void onLogout()}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                  {isLoggingOut ? "退出中" : "退出登录"}
                </Button>
              ) : null}

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

              <CheckinAllActionButton
                hasAccounts={Boolean(dashboard?.accounts.length)}
                checkinQueue={checkinQueue}
              />
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
              <OverviewPanel dashboard={dashboard ?? null} />
              <AccountListPanel
                loading={loading}
                filteredAccounts={filteredAccounts}
                filter={filter}
                selectedUsername={selectedUsername}
                checkinQueue={checkinQueue}
                usageQueue={usageQueue}
                onFilterChange={setFilter}
                onSelect={setSelectedUsername}
              />
            </section>

            <aside className="flex h-full flex-col gap-2.5 xl:col-span-4">
              <AccountDetailPanel
                dashboard={dashboard ?? null}
                selectedUsername={selectedUsername}
                checkinQueue={checkinQueue}
                usageQueue={usageQueue}
                onSelect={setSelectedUsername}
              />
              <Suspense fallback={<AnalysisPanelFallback />}>
                <LazyQuotaAnalysisPanel dashboard={dashboard ?? null} darkMode={darkMode} />
              </Suspense>
            </aside>
          </div>
        </div>
      </main>

      <AccountImportModal
        isOpen={importModalOpen}
        provider={selectedProvider}
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
    </QuotaMonitorActionProvider>
  );
}
