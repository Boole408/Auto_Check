import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, CheckCircle2, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
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
  formatTime,
  getAccountInitial,
  getAccountQueueHint,
  getCheckinSourceText,
  getCheckinStatusText,
  getSingleActionLabel,
  getTodayUsedStatusText,
  getTodayUsedText,
  getUsageSourceText,
  money,
  percent,
  usageTone
} from "@/lib/formatters";
import type { CheckinQueueState, QuotaDashboard, UsageSyncState } from "@/types";
import {
  getCheckinBadge,
  QueueMetaCell
} from "@/features/quota-monitor/components/shared";
import { useQuotaMonitorActions } from "@/features/quota-monitor/context/QuotaMonitorActionContext";

interface AccountDetailPanelProps {
  dashboard: QuotaDashboard | null;
  selectedUsername: string;
  checkinQueue: CheckinQueueState | undefined;
  usageQueue: UsageSyncState | undefined;
  onSelect: (username: string) => void;
}

export const AccountDetailPanel = memo(function AccountDetailPanel({
  dashboard,
  selectedUsername,
  checkinQueue,
  usageQueue,
  onSelect
}: AccountDetailPanelProps) {
  const { handleSingleCheckin, workingAccount } = useQuotaMonitorActions();
  const [expandedDetailUsername, setExpandedDetailUsername] = useState<string | null>(null);

  const selectedAccount = useMemo(() => {
    if (!dashboard?.accounts.length) return null;
    return (
      dashboard.accounts.find((account) => account.username === selectedUsername) ??
      dashboard.accounts[0]
    );
  }, [dashboard, selectedUsername]);
  const detailExpanded =
    selectedAccount != null && expandedDetailUsername === selectedAccount.username;

  const selectedUsageTone = usageTone(selectedAccount?.usagePercent ?? 0);
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

  return (
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
              <Select value={selectedAccount?.username ?? ""} onValueChange={onSelect}>
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
                      <p className="text-[11px] font-semibold tracking-[0.14em] text-white/72">当前焦点账号</p>
                      <h3 className="mt-1 truncate text-[1.34rem] font-black tracking-tight">
                        {selectedAccount.displayName || selectedAccount.username}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {getCheckinBadge(selectedAccount)}
                        <span className="text-[11px] text-white/78">
                          {getAccountQueueHint(selectedAccount, checkinQueue, usageQueue)}
                        </span>
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
                  onClick={() =>
                    setExpandedDetailUsername((current) =>
                      current === selectedAccount.username ? null : selectedAccount.username
                    )
                  }
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
  );
});
