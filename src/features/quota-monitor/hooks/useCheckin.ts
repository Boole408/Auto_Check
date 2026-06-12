import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/axios";
import { checkinAccount } from "@/services/account";
import { checkinAll } from "@/services/quota";
import { quotaMonitorQueryKey } from "@/features/quota-monitor/hooks/useQuotaData";
import type { AccountQuota, CheckinScope } from "@/types";

interface UseCheckinOptions {
  provider?: string;
  onNotice?: (message: string) => void;
}

function getCheckinErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 429) {
    return "站点限流，请稍后重试";
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

export function useCheckin({ provider = "muyuan", onNotice }: UseCheckinOptions = {}) {
  const queryClient = useQueryClient();

  const invalidateQuotaMonitor = useCallback(
    async () =>
      queryClient.invalidateQueries({
        queryKey: quotaMonitorQueryKey(provider)
      }),
    [provider, queryClient]
  );

  const {
    mutateAsync: mutateSingleCheckin,
    isPending: isSingleCheckinPending,
    variables: singleCheckinVariables
  } = useMutation({
    mutationFn: (username: string) => checkinAccount(username, provider),
    onSuccess: async (result) => {
      onNotice?.(result.message || "签到成功");
      await invalidateQuotaMonitor();
    },
    onError: (error) => {
      onNotice?.(getCheckinErrorMessage(error, "签到失败"));
    }
  });

  const {
    mutateAsync: mutateCheckinAll,
    isPending: isCheckinAllPending,
    variables: checkinAllVariables
  } = useMutation({
    mutationFn: (scope: CheckinScope) => checkinAll(scope, provider),
    onSuccess: async (result) => {
      onNotice?.(result.message);
      await invalidateQuotaMonitor();
    },
    onError: (error, scope) => {
      onNotice?.(
        getCheckinErrorMessage(error, scope === "failed" ? "失败账号重试失败" : "一键签到失败")
      );
    }
  });

  const handleSingleCheckin = useCallback(
    async (account: AccountQuota) => {
      if (account.signedToday) {
        return;
      }

      await mutateSingleCheckin(account.username);
    },
    [mutateSingleCheckin]
  );

  const handleCheckinAll = useCallback(
    async (scope: CheckinScope) => {
      await mutateCheckinAll(scope);
    },
    [mutateCheckinAll]
  );

  return {
    handleSingleCheckin,
    handleCheckinAll,
    workingAccount: isSingleCheckinPending ? (singleCheckinVariables ?? null) : null,
    workingScope: isCheckinAllPending ? (checkinAllVariables ?? null) : null
  };
}
