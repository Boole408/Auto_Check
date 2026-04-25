import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle2,
  Coins,
  RefreshCw,
  ShieldAlert,
  WalletMinimal,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  describeAutoCheckin,
  formatCompactTime,
  formatTime,
  getAutoCheckinLabel,
  money,
  normalizeUsageQueue,
  percent
} from "@/lib/formatters";
import { QueueMetaCell } from "@/features/quota-monitor/components/shared";
import type { QuotaDashboard } from "@/types";

interface OverviewPanelProps {
  dashboard: QuotaDashboard | null;
}

export const OverviewPanel = memo(function OverviewPanel({ dashboard }: OverviewPanelProps) {
  const [autoCheckinExpanded, setAutoCheckinExpanded] = useState(false);

  const usageQueue = useMemo(
    () => normalizeUsageQueue(dashboard?.sync.usageSync),
    [dashboard?.sync.usageSync]
  );
  const autoCheckin = dashboard?.sync.autoCheckin;
  const accounts = dashboard?.accounts ?? [];
  const currencySymbol = dashboard?.currencySymbol || accounts[0]?.currencySymbol || "¥";

  const accountCount = dashboard?.summary.accountCount ?? accounts.length ?? 0;
  const checkinCompleted =
    dashboard?.summary.checkedInCount ?? accounts.filter((account) => account.signedToday).length;
  const checkinFailed = accounts.filter((account) => account.checkinStatus === "failed").length;
  const checkinPending = Math.max(accountCount - checkinCompleted - checkinFailed, 0);
  const checkinDisplayTotal = accountCount;

  const usageCoverageCompleted = dashboard?.summary.todayUsedCoverage.exactOrStaleAccounts ?? 0;
  const usageCoverageTotal = dashboard?.summary.todayUsedCoverage.totalAccounts ?? 0;
  const usagePending =
    usageQueue?.progress.pending ??
    Math.max(
      (usageQueue?.progress.total ?? usageCoverageTotal) -
        (usageQueue?.progress.completed ?? usageCoverageCompleted) -
        (usageQueue?.progress.skipped ?? 0) -
        (usageQueue?.progress.failed ?? 0),
      0
    );
  const usageDisplayTotal = usageCoverageTotal || accountCount;

  const issueAccountsCount = accounts.filter(
    (account) => account.checkinStatus === "failed" || account.todayUsedStatus === "unavailable"
  ).length;

  const overallTaskTotal = checkinDisplayTotal + usageDisplayTotal;
  const overallTaskCompleted = checkinCompleted + usageCoverageCompleted;
  const overallProgress = overallTaskTotal ? (overallTaskCompleted / overallTaskTotal) * 100 : 0;
  const overallProgressHint = accountCount
    ? `共 ${accountCount} 个账号，按“签到 + 用量同步”两项统计`
    : "按“签到 + 用量同步”两项统计";
  const todayUsedRawTotal = Math.round(dashboard?.summary.todayUsedRawTotal ?? 0);
  const todayUsedRawText = dashboard
    ? `${todayUsedRawTotal.toLocaleString("zh-CN")} tokens`
    : "加载中";

  const primaryOverviewCards = [
    {
      label: "签到完成",
      value: dashboard ? `${checkinCompleted} / ${checkinDisplayTotal}` : "加载中",
      hint: dashboard
        ? checkinFailed
          ? `${checkinFailed} 个签到异常待处理`
          : checkinPending
            ? `${checkinPending} 个账号待签到`
            : "全部账号今日已签到"
        : "等待接口返回",
      icon: CheckCircle2
    },
    {
      label: "用量同步",
      value: dashboard ? `${usageCoverageCompleted} / ${usageDisplayTotal}` : "加载中",
      hint: dashboard
        ? usagePending
          ? `${usagePending} 个账号待同步`
          : "全部账号当日用量已同步"
        : "等待接口返回",
      icon: RefreshCw
    },
    {
      label: "异常账号",
      value: dashboard ? issueAccountsCount : "加载中",
      hint: dashboard
        ? issueAccountsCount
          ? "优先处理登录或同步异常"
          : "当前没有明显异常"
        : "等待接口返回",
      icon: ShieldAlert
    }
  ];

  const summaryCards = [
    {
      title: "今日总签到收益",
      value: dashboard ? money(dashboard.summary.todayCheckinIncome, currencySymbol) : "加载中",
      icon: Zap,
      hint: dashboard ? `${checkinCompleted}/${accountCount} 个账号已签到` : "等待接口返回"
    },
    {
      title: "当日总 Token 消耗量",
      value: todayUsedRawText,
      icon: Coins,
      hint: `按接口原始用量汇总，覆盖 ${usageCoverageCompleted}/${usageDisplayTotal}`
    },
    {
      title: "今日已用额度",
      value: dashboard ? money(dashboard.summary.todayUsed, currencySymbol) : "加载中",
      icon: Activity,
      hint: dashboard ? `覆盖 ${usageCoverageCompleted}/${usageDisplayTotal}` : "等待接口返回"
    },
    {
      title: "今日剩余额度",
      value: dashboard ? money(dashboard.summary.todayRemaining, currencySymbol) : "加载中",
      icon: WalletMinimal,
      hint: dashboard
        ? `覆盖 ${dashboard.summary.todayRemainingCoverage.exactOrStaleAccounts}/${dashboard.summary.todayRemainingCoverage.totalAccounts}`
        : "等待接口返回"
    }
  ];

  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="shrink-0">
      <Card className="overflow-hidden border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
        <CardHeader className="pb-2.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <CardTitle className="text-[1.08rem] text-[#102A24] dark:text-[#E7F7F0]">
                今日总览
              </CardTitle>
              <CardDescription className="mt-1 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                刷新时间 {formatCompactTime(dashboard?.refreshedAt)}，优先展示今天需要处理的任务与告警信息。
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
                      <p className="mt-1 text-[10px] text-[#9AABA5] dark:text-[#667B73]">
                        {metric.hint}
                      </p>
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
                <p className="text-[12px] font-semibold text-[#2F4A43] dark:text-[#D5ECE4]">
                  今日任务完成度
                </p>
                <p className="mt-1 text-[11px] text-[#71867F] dark:text-[#89A39B]">
                  {overallProgressHint}
                </p>
                <p className="mt-1 text-[11px] text-[#71867F] dark:text-[#89A39B]">
                  签到状态：已签到 {checkinCompleted}/{checkinDisplayTotal}，异常 {checkinFailed}，待签到 {checkinPending}，
                  用量同步：{usageCoverageCompleted}/{usageDisplayTotal}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[1.2rem] font-black leading-none tracking-tight text-[#102A24] dark:text-[#F0FBF6]">
                  {overallTaskTotal ? percent(overallProgress) : "0.0%"}
                </p>
                <p className="mt-1 text-[11px] text-[#71867F] dark:text-[#89A39B]">
                  {overallTaskCompleted}/{overallTaskTotal || 0} 任务项
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
  );
});
