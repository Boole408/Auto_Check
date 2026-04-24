import type {
  AccountQuota,
  AutoCheckinState,
  AutoCheckinStatus,
  CheckinQueueState,
  QueueLifecycleStatus,
  UsageSyncState
} from "@/types";

export function money(value: number | null | undefined, symbol = "楼") {
  if (value == null) return "待同步";
  return `${symbol}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function percent(value: number | null | undefined) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function formatTime(value?: string | null) {
  if (!value) return "未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export function formatCompactTime(value?: string | null) {
  if (!value) return "未安排";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatCountdown(value?: string | null, now = Date.now()) {
  if (!value) return null;
  const diff = new Date(value).getTime() - now;
  if (diff <= 0) return "00:00";
  const totalSeconds = Math.ceil(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function usageTone(value: number) {
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
    bar: "bg-[linear-gradient(90deg,#34C79A,#7BE3C2)]",
    text: "text-[#08785C]",
    badge: "success" as const
  };
}

export function getQueueVariant(status?: QueueLifecycleStatus) {
  if (status === "cooldown") return "warning" as const;
  if (status === "running") return "default" as const;
  if (status === "completed") return "success" as const;
  if (status === "paused") return "outline" as const;
  return "secondary" as const;
}

export function getQueueLabel(status?: QueueLifecycleStatus) {
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

export function getAutoCheckinVariant(status?: AutoCheckinStatus) {
  switch (status) {
    case "running":
      return "default" as const;
    case "cooldown":
    case "retrying":
      return "warning" as const;
    case "triggered":
      return "success" as const;
    case "disabled":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

export function getAutoCheckinLabel(status?: AutoCheckinStatus) {
  switch (status) {
    case "running":
      return "执行中";
    case "cooldown":
      return "冷却中";
    case "retrying":
      return "重试中";
    case "triggered":
      return "已触发";
    case "disabled":
      return "已关闭";
    default:
      return "待执行";
  }
}

export function describeAutoCheckin(autoCheckin: AutoCheckinState | undefined) {
  if (!autoCheckin) return "自动签到状态读取中";

  switch (autoCheckin.status) {
    case "disabled":
      return "当前未启用每日自动签到。";
    case "running":
      return "今日自动任务已触发，签到队列正在执行。";
    case "cooldown":
      return "自动任务已触发，但当前处于限流冷却中。";
    case "retrying":
      return autoCheckin.lastErrorMessage || "上次自动触发失败，系统会按退避策略继续重试。";
    case "triggered":
      return "今天的自动签到已经触发完成。";
    default:
      return `每日会按 ${autoCheckin.time} 自动触发签到队列。`;
  }
}

export function normalizeUsageQueue(queue: UsageSyncState | undefined) {
  if (!queue) return queue;
  if (queue.status === "completed") return queue;
  if (queue.progress.total > 0 && queue.progress.pending === 0 && !queue.currentUsername) {
    return {
      ...queue,
      status: "completed" as const,
      cooldownUntil: null,
      message: "当日用量已同步"
    };
  }
  return queue;
}

export function getTodayUsedText(account: AccountQuota) {
  if (account.todayUsedStatus === "pending") return "待同步";
  if (account.todayUsedStatus === "unavailable" && account.todayUsed == null) return "不可用";
  return money(account.todayUsed, account.currencySymbol);
}

export function getUsageSourceText(account: AccountQuota) {
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

export function getCheckinSourceText(account: AccountQuota) {
  return account.dataSource?.checkin === "remote" ? "远程确认" : "本地缓存";
}

export function getCheckinActionLabel(queue: CheckinQueueState | undefined, pending = false) {
  if (queue?.status === "cooldown") {
    return "冷却中";
  }

  if (pending || queue?.status === "running") {
    return "一键签到中...";
  }

  return "一键签到";
}

export function getSingleActionLabel(
  account: AccountQuota,
  working: boolean,
  coolingDown: boolean
) {
  if (account.signedToday) return "今日已签到";
  if (coolingDown) return "冷却中";
  return working ? "签到中..." : "去签到";
}

export function getCheckinStatusText(account: AccountQuota) {
  if (account.signedToday) return "今日已签到";
  if (account.checkinStatus === "failed") return "签到异常";
  if (account.checkinStatus === "unknown") return "待确认";
  return "未签到";
}

export function getTodayUsedStatusText(status: AccountQuota["todayUsedStatus"]) {
  switch (status) {
    case "exact":
      return "精确";
    case "stale":
      return "缓存";
    case "unavailable":
      return "不可用";
    default:
      return "待同步";
  }
}

export function getAccountInitial(account: AccountQuota) {
  const source = account.displayName || account.username;
  const value = source.trim().charAt(0);
  return value ? value.toUpperCase() : "A";
}

export function matchesFilter(
  account: AccountQuota,
  filter: "all" | "checked" | "pending" | "error" | "unchecked"
) {
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

export function getAccountQueueHint(
  account: AccountQuota,
  checkinQueue: CheckinQueueState | undefined,
  usageQueue: UsageSyncState | undefined
) {
  if (checkinQueue?.currentUsername === account.username) return "当前正在签到";
  if (usageQueue?.currentUsername === account.username) return "当前正在同步当日用量";
  if (checkinQueue?.status === "cooldown") return "签到队列冷却中";
  if (checkinQueue?.status === "running" && !account.signedToday) return "等待签到队列处理";
  if (usageQueue?.status === "running" && account.todayUsedStatus !== "exact") {
    return "等待同步当日用量";
  }
  return "当前无排队任务";
}

