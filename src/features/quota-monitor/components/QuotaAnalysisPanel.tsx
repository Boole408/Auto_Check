import { memo, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/formatters";
import type { QuotaDashboard } from "@/types";
import { cn } from "@/lib/utils";

type AnalysisTab = "comparison" | "checkinTrend" | "usageTrend";

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
    description: "对比各账号今日已用与当前可用额度，默认只展开一张图。"
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

interface QuotaAnalysisPanelProps {
  dashboard: QuotaDashboard | null;
  darkMode: boolean;
}

export const QuotaAnalysisPanel = memo(function QuotaAnalysisPanel({
  dashboard,
  darkMode
}: QuotaAnalysisPanelProps) {
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("comparison");

  const comparisonData = useMemo(
    () =>
      dashboard?.accounts.map((account) => ({
        name: account.displayName || account.username,
        todayUsed:
          account.todayUsedStatus === "exact" || account.todayUsedStatus === "stale"
            ? account.todayUsed
            : null,
        remainingQuota: account.remainingQuota,
        balance: account.balance
      })) ?? [],
    [dashboard?.accounts]
  );
  const trendData = dashboard?.trend ?? [];
  const usageTrendData = trendData.filter((item) => item.usedQuota != null);
  const currencySymbol = dashboard?.currencySymbol || dashboard?.accounts[0]?.currencySymbol || "¥";
  const analysisMeta = ANALYSIS_TABS.find((item) => item.key === analysisTab) ?? ANALYSIS_TABS[0];
  const chartGridStroke = darkMode ? "#1F322C" : "#E8F0EC";
  const chartMargin = { top: 14, right: 8, left: -18, bottom: 6 };
  const chartAxisTickStyle = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
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
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex-1">
      <Card className="flex h-full min-h-[252px] flex-col border-[#DDEAE5] bg-[rgba(255,255,255,0.86)] shadow-[0_12px_32px_rgba(16,42,36,0.06)] dark:border-[#233A33] dark:bg-[rgba(18,28,24,0.88)] dark:shadow-[0_16px_32px_rgba(0,0,0,0.3)]">
        <CardHeader className="pb-2.5">
          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <CardTitle className="text-[1.08rem] text-[#102A24] dark:text-[#E7F7F0]">数据分析</CardTitle>
                <CardDescription className="mt-1 text-[12px] text-[#71867F] dark:text-[#8DA69E]">
                  对比各账号今日已用与当前可用额度，默认只展示一个紧凑图表。
                </CardDescription>
              </div>
              <Badge variant="outline" className="px-3 py-1 text-[11px]">
                {analysisTab === "usageTrend"
                  ? `已同步 ${usageTrendData.length} 天`
                  : `最近 ${trendData.length || comparisonData.length} 条数据`}
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
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartRemainingColor }} />
                  当前可用
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#34C79A]" />
                {analysisMeta.label}
              </span>
            )}
          </div>

          <div className="h-[260px] min-h-[260px] w-full flex-1 rounded-[1.08rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] px-2 pt-3 pb-1.5 dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)]">
            {analysisTab === "comparison" ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData} barGap={8} margin={chartMargin}>
                  <CartesianGrid stroke={chartGridStroke} strokeOpacity={1} vertical={false} />
                  <XAxis dataKey="name" tick={chartAxisTickStyle} tickMargin={10} height={26} />
                  <YAxis tick={chartAxisTickStyle} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;

                      const todayUsedValue = Number(
                        payload.find((item) => item.dataKey === "todayUsed")?.value
                      );
                      const remainingQuotaValue = Number(
                        payload.find((item) => item.dataKey === "remainingQuota")?.value
                      );
                      const todayUsedRawValue = payload.find((item) => item.dataKey === "todayUsed")?.value;
                      const remainingQuotaRawValue = payload.find(
                        (item) => item.dataKey === "remainingQuota"
                      )?.value;

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
                              <span>
                                {todayUsedRawValue == null
                                  ? "待同步"
                                  : money(todayUsedValue, currencySymbol)}
                              </span>
                            </div>
                            <div
                              className="flex items-center justify-between gap-4 text-sm font-semibold"
                              style={{ color: chartTooltipValueColor }}
                            >
                              <span>当前可用</span>
                              <span>
                                {remainingQuotaRawValue == null
                                  ? "待同步"
                                  : money(remainingQuotaValue, currencySymbol)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="todayUsed" name="今日已用" fill={chartUsedColor} radius={[6, 6, 0, 0]} maxBarSize={20} />
                  <Bar
                    dataKey="remainingQuota"
                    name="当前可用"
                    fill={chartRemainingColor}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : null}

            {analysisTab === "checkinTrend" ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={chartMargin}>
                  <CartesianGrid stroke={chartGridStroke} strokeOpacity={1} vertical={false} />
                  <XAxis dataKey="date" tick={chartAxisTickStyle} tickMargin={10} height={26} />
                  <YAxis tick={chartAxisTickStyle} />
                  <Tooltip
                    formatter={(value) =>
                      value == null ? "未同步" : money(Number(value), currencySymbol)
                    }
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
              usageTrendData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={usageTrendData} margin={chartMargin}>
                    <CartesianGrid stroke={chartGridStroke} strokeOpacity={1} vertical={false} />
                    <XAxis dataKey="date" tick={chartAxisTickStyle} tickMargin={10} height={26} />
                    <YAxis tick={chartAxisTickStyle} />
                    <Tooltip
                      formatter={(value) =>
                        value == null ? "未同步" : money(Number(value), currencySymbol)
                      }
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
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  暂无已同步的真实用量趋势数据
                </div>
              )
            ) : null}
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
});
