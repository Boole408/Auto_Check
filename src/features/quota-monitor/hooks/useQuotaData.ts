import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getQuotaMonitor } from "@/services/quota";

const QUOTA_MONITOR_REFETCH_INTERVAL_MS = 30_000;
const QUOTA_MONITOR_QUERY_KEY = ["quota-monitor"] as const;

export function quotaMonitorQueryKey(selectedUsername?: string | null) {
  if (selectedUsername === undefined) {
    return QUOTA_MONITOR_QUERY_KEY;
  }

  return [...QUOTA_MONITOR_QUERY_KEY, selectedUsername || null] as const;
}

export function useQuotaData(selectedUsername?: string | null) {
  return useQuery({
    queryKey: quotaMonitorQueryKey(selectedUsername ?? null),
    queryFn: ({ signal }) =>
      getQuotaMonitor({
        signal,
        selectedUsername: selectedUsername || null
      }),
    refetchInterval: QUOTA_MONITOR_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    retry: 1
  });
}

export function useForceRefreshQuota(selectedUsername?: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      getQuotaMonitor({
        force: true,
        selectedUsername: selectedUsername || null
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: quotaMonitorQueryKey()
      });
    }
  });
}
