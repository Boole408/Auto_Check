import { memo, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAccountInitial,
  getAccountQueueHint,
  getSingleActionLabel,
  getTodayUsedStatusText,
  getTodayUsedText,
  money
} from "@/lib/formatters";
import type { AccountQuota, CheckinQueueState, UsageSyncState } from "@/types";
import {
  type AccountFilter,
  EXTRA_FILTERS,
  getCheckinBadge,
  getTodayUsedBadge,
  PRIMARY_FILTERS
} from "@/features/quota-monitor/components/shared";
import { useQuotaMonitorActions } from "@/features/quota-monitor/context/QuotaMonitorActionContext";
import { cn } from "@/lib/utils";

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
  "xl:grid-cols-[minmax(0,2.6fr)_0.9fr_0.9fr_1fr_1fr_84px_164px]";

interface AccountListItemProps {
  account: AccountQuota;
  isSelected: boolean;
  coolingDown: boolean;
  isWorking: boolean;
  isDeleting: boolean;
  deleteLocked: boolean;
  checkinQueue: CheckinQueueState | undefined;
  usageQueue: UsageSyncState | undefined;
  onSelect: (username: string) => void;
  onSingleCheckin: (account: AccountQuota) => Promise<void>;
  onDeleteAccount: (account: AccountQuota) => Promise<void>;
}

const AccountListItem = memo(function AccountListItem({
  account,
  isSelected,
  coolingDown,
  isWorking,
  isDeleting,
  deleteLocked,
  checkinQueue,
  usageQueue,
  onSelect,
  onSingleCheckin,
  onDeleteAccount
}: AccountListItemProps) {
  const accountLabel = account.displayName || account.username;
  const isQueueWorking =
    checkinQueue?.status === "running" && checkinQueue.currentUsername === account.username;
  const deleteDisabled = isDeleting || deleteLocked || isWorking || isQueueWorking;
  const deleteTitle = isDeleting
    ? `正在删除账号 ${accountLabel}`
    : isQueueWorking
      ? "账号正在签到，稍后删除"
      : `删除账号 ${accountLabel}`;

  return (
    <motion.article
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
            onClick={() => onSelect(account.username)}
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
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6.5 px-3 text-[10px]"
              onClick={() => onSelect(account.username)}
            >
              查看
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-[1.625rem] w-[1.625rem] px-0 text-[#C43B3B] hover:border-[#E16868] hover:bg-[#FFF1F1] hover:text-[#B42323] dark:text-[#F28B8B] dark:hover:border-[#F28B8B] dark:hover:bg-[#2B1717]"
              disabled={deleteDisabled}
              onClick={() => void onDeleteAccount(account)}
              aria-label={deleteTitle}
              title={deleteTitle}
            >
              {isDeleting ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div>
            <p className="text-[#71867F] dark:text-[#89A39B]">今日已用</p>
            <p className="mt-0.5 font-semibold text-[#102A24] dark:text-[#E7F7F0]">
              {getTodayUsedText(account)}
            </p>
          </div>
          <div>
            <p className="text-[#71867F] dark:text-[#89A39B]">当前可用</p>
            <p className="mt-0.5 font-semibold text-[#102A24] dark:text-[#E7F7F0]">
              {money(account.remainingQuota, account.currencySymbol)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 rounded-[0.9rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.78)] px-3 py-1.5 dark:border-[#294038] dark:bg-[rgba(20,31,27,0.86)]">
            <div className="flex items-center justify-between gap-2 text-[10px] text-[#71867F] dark:text-[#89A39B]">
              <span>后台状态</span>
              <span className="font-semibold">
                {getTodayUsedStatusText(account.todayUsedStatus)}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] text-[#9AABA5] dark:text-[#667B73]">
              {getAccountQueueHint(account, checkinQueue, usageQueue)}
            </p>
          </div>
          <Button
            size="sm"
            variant={account.signedToday ? "secondary" : "default"}
            className="h-6.5 px-3 text-[10px]"
            disabled={account.signedToday || coolingDown || isWorking || isDeleting}
            onClick={() => void onSingleCheckin(account)}
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
          onClick={() => onSelect(account.username)}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#34C79A] text-[12px] font-black text-white">
            {getAccountInitial(account)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-[#102A24] dark:text-[#E7F7F0]">
              {account.displayName || account.username}
            </p>
            <p className="mt-0.5 truncate text-[9px] text-[#71867F] dark:text-[#89A39B]">
              {account.signedToday
                ? "签到正常且用量当日清"
                : getAccountQueueHint(account, checkinQueue, usageQueue)}
            </p>
          </div>
        </button>
        <div className="flex justify-center">{getCheckinBadge(account)}</div>
        <div className="flex justify-center">{getTodayUsedBadge(account.todayUsedStatus)}</div>
        <div className="text-center font-semibold text-[#102A24] dark:text-[#E7F7F0]">
          {getTodayUsedText(account)}
        </div>
        <div className="text-center font-semibold text-[#102A24] dark:text-[#E7F7F0]">
          {money(account.remainingQuota, account.currencySymbol)}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 justify-self-center px-3 text-[10px]"
          onClick={() => onSelect(account.username)}
        >
          查看
        </Button>
        <div className="flex items-center justify-center gap-1.5">
          <Button
            size="sm"
            variant={account.signedToday ? "secondary" : "default"}
            className="h-6 px-3 text-[10px]"
            disabled={account.signedToday || coolingDown || isWorking || isDeleting}
            onClick={() => void onSingleCheckin(account)}
          >
            {isWorking ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {getSingleActionLabel(account, isWorking, Boolean(coolingDown))}
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-6 w-6 shrink-0 px-0 text-[#C43B3B] hover:border-[#E16868] hover:bg-[#FFF1F1] hover:text-[#B42323] dark:text-[#F28B8B] dark:hover:border-[#F28B8B] dark:hover:bg-[#2B1717]"
            disabled={deleteDisabled}
            onClick={() => void onDeleteAccount(account)}
            aria-label={deleteTitle}
            title={deleteTitle}
          >
            {isDeleting ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </motion.article>
  );
});

interface AccountListPanelProps {
  loading: boolean;
  filteredAccounts: AccountQuota[];
  filter: AccountFilter;
  selectedUsername: string;
  checkinQueue: CheckinQueueState | undefined;
  usageQueue: UsageSyncState | undefined;
  onFilterChange: (filter: AccountFilter) => void;
  onSelect: (username: string) => void;
}

export const AccountListPanel = memo(function AccountListPanel({
  loading,
  filteredAccounts,
  filter,
  selectedUsername,
  checkinQueue,
  usageQueue,
  onFilterChange,
  onSelect
}: AccountListPanelProps) {
  const {
    handleSingleCheckin,
    handleCheckinAll,
    handleDeleteAccount,
    workingAccount,
    workingScope,
    deletingAccount
  } = useQuotaMonitorActions();
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const failedAccountsCount = checkinQueue?.progress.failed ?? 0;

  const handleDeleteClick = useCallback(
    async (account: AccountQuota) => {
      const accountLabel =
        account.displayName && account.displayName !== account.username
          ? `${account.displayName}（${account.username}）`
          : account.username;
      const confirmed = window.confirm(
        `确认删除账号 ${accountLabel}？删除前会自动备份账号文件。`
      );

      if (!confirmed) {
        return;
      }

      await handleDeleteAccount(account);
    },
    [handleDeleteAccount]
  );

  useEffect(() => {
    if (filter === "checked") {
      setMoreFiltersOpen(true);
    }
  }, [filter]);

  return (
    <motion.section variants={listVariants} initial="hidden" animate="show" className="flex-1">
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
                  onClick={() => onFilterChange(item.key)}
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
                  onClick={() => onFilterChange(item.key)}
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
                  <span className="text-center">当前可用</span>
                  <span className="text-center">查看</span>
                  <span className="text-center">操作</span>
                </div>

                {filteredAccounts.map((account) => (
                  <AccountListItem
                    key={account.username}
                    account={account}
                    isSelected={selectedUsername === account.username}
                    coolingDown={checkinQueue?.status === "cooldown"}
                    isWorking={workingAccount === account.username}
                    isDeleting={deletingAccount === account.username}
                    deleteLocked={deletingAccount !== null && deletingAccount !== account.username}
                    checkinQueue={checkinQueue}
                    usageQueue={usageQueue}
                    onSelect={onSelect}
                    onSingleCheckin={handleSingleCheckin}
                    onDeleteAccount={handleDeleteClick}
                  />
                ))}
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
  );
});
