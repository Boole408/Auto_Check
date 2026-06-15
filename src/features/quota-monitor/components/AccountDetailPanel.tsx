import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  money
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

function getAuthTypeText(account: QuotaDashboard["accounts"][number]) {
  if (account.loginProvider === "linuxdo" || account.authType === "linuxdo") return "LinuxDo OAuth";
  if (account.credentialKind === "cookie") return "网页登录态 Cookie";
  if (account.credentialKind === "token") return "网页登录态 Token";
  if (account.credentialKind === "api_key") return "模型 API Key";
  if (account.credentialKind === "password") return "账号密码";
  return "未识别";
}

function getCredentialKindText(account: QuotaDashboard["accounts"][number]) {
  if (account.credentialKind === "cookie") return "Cookie";
  if (account.credentialKind === "token") return "Token";
  if (account.credentialKind === "api_key") return "API Key";
  if (account.credentialKind === "password") return "Password";
  return "None";
}

function getSessionStatusText(account: QuotaDashboard["accounts"][number]) {
  if (account.sessionStatus === "valid") return "有效";
  if (account.sessionStatus === "expiring") return "即将到期";
  if (account.sessionStatus === "expired") return "已过期";
  return "未标注";
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
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  const selectedAccount = useMemo(() => {
    if (!dashboard?.accounts.length) return null;
    return (
      dashboard.accounts.find((account) => account.username === selectedUsername) ??
      dashboard.accounts[0]
    );
  }, [dashboard, selectedUsername]);
  const detailExpanded =
    selectedAccount != null && expandedDetailUsername === selectedAccount.username;

  const selectedApiKey = selectedAccount?.apiKey?.trim();
  const handleCopyApiKey = async () => {
    if (!selectedApiKey) return;

    await navigator.clipboard.writeText(selectedApiKey);
    setCopiedApiKey(true);
    window.setTimeout(() => setCopiedApiKey(false), 1400);
  };
  const selectedAccountMetrics = selectedAccount
    ? [
        {
          label: "今日已用",
          value: getTodayUsedText(selectedAccount),
          hint: getUsageSourceText(selectedAccount)
        },
        {
          label: "当前可用",
          value: money(selectedAccount.remainingQuota, selectedAccount.currencySymbol),
          hint: "站点当前余额"
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
          label: "API Key",
          value: selectedApiKey || "待同步",
          hint: selectedApiKey
            ? `同步于 ${formatTime(selectedAccount.apiKeyUpdatedAt)}`
            : selectedAccount.apiKeyUpdatedAt
              ? "当前账号未配置可用 key"
              : "等待后台同步当前账号 key",
          icon: KeyRound,
          valueClassName: selectedApiKey
            ? "break-all font-mono text-[0.72rem] leading-relaxed"
            : ""
        },
        {
          label: "登录方式",
          value: getAuthTypeText(selectedAccount),
          hint: selectedAccount.userId
            ? `userId ${selectedAccount.userId} | ${getCredentialKindText(selectedAccount)}`
            : `凭据 ${getCredentialKindText(selectedAccount)}`,
          icon: Fingerprint
        },
        {
          label: "登录态",
          value: getSessionStatusText(selectedAccount),
          hint: selectedAccount.sessionExpiresAt
            ? `到期 ${formatTime(selectedAccount.sessionExpiresAt)}`
            : "站点未返回明确到期时间",
          icon: ShieldCheck
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
            <div className="min-w-[148px] max-w-[220px]">
              <Select value={selectedAccount?.username ?? ""} onValueChange={onSelect}>
                <SelectTrigger className="h-10 rounded-full border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] px-4 text-left text-[13px] font-medium leading-normal shadow-none dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#E7F7F0]">
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

              </div>

              <div className="grid auto-rows-fr gap-2 sm:grid-cols-2">
                {selectedAccountCoreFields.map((field) => {
                  const Icon = field.icon;
                  const isApiKeyField = field.label === "API Key";
                  const valueClassName = "valueClassName" in field ? field.valueClassName : "";
                  return (
                    <div
                      key={field.label}
                      className={`relative min-h-[94px] rounded-[0.96rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.84)] px-3.5 py-2.5 shadow-[0_10px_18px_rgba(16,42,36,0.05)] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.84)] dark:shadow-[0_12px_18px_rgba(0,0,0,0.22)] ${
                        isApiKeyField && selectedApiKey ? "pb-10" : ""
                      }`}
                    >
                      <div className="flex h-full min-w-0 items-start justify-between gap-3">
                        <div className={`min-w-0 flex-1 ${isApiKeyField && selectedApiKey ? "pr-2" : ""}`}>
                          <p className="text-[11px] text-[#71867F] dark:text-[#89A39B]">{field.label}</p>
                          <p className={`mt-1 break-words text-[0.95rem] font-semibold leading-snug text-[#102A24] dark:text-[#E7F7F0] ${valueClassName}`}>
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
                      {isApiKeyField && selectedApiKey ? (
                        <button
                          type="button"
                          className="absolute bottom-2.5 right-3 grid h-7 w-7 place-items-center rounded-full border border-[#BDEDDD] bg-[#ECFBF6] text-[#1E7E63] shadow-[0_6px_12px_rgba(16,42,36,0.08)] transition hover:-translate-y-0.5 hover:bg-white hover:text-[#15956F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34C79A]/50 dark:border-[#31534A] dark:bg-[#172E27] dark:text-[#7FE0BE] dark:hover:bg-[#1F3A32]"
                          onClick={() => void handleCopyApiKey()}
                          aria-label={copiedApiKey ? "API Key 已复制" : "复制 API Key"}
                          title={copiedApiKey ? "已复制" : "复制 API Key"}
                        >
                          {copiedApiKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      ) : null}
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
