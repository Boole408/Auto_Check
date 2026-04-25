import { memo, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { AccountQuota, TodayUsedStatus } from "@/types";
import { cn } from "@/lib/utils";

export const FILTERS = [
  { key: "all", label: "全部" },
  { key: "checked", label: "已签到" },
  { key: "pending", label: "待同步" },
  { key: "error", label: "异常" },
  { key: "unchecked", label: "未签到" }
] as const;

export type AccountFilter = (typeof FILTERS)[number]["key"];

export const PRIMARY_FILTERS = FILTERS.filter((item) => item.key !== "checked");
export const EXTRA_FILTERS = FILTERS.filter((item) => item.key === "checked");

export function getCheckinBadge(account: AccountQuota) {
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
        className={cn(
          className,
          "border-[#DDEAE5] bg-[#F3F8F5] text-[#4D625B] dark:border-[#294038] dark:bg-[#16241f] dark:text-[#A3BBB3]"
        )}
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

export function getTodayUsedBadge(status: TodayUsedStatus) {
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

interface QueueMetaCellProps {
  label: string;
  value: ReactNode;
  className?: string;
  valueClassName?: string;
}

export const QueueMetaCell = memo(function QueueMetaCell({
  label,
  value,
  className,
  valueClassName
}: QueueMetaCellProps) {
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
});
