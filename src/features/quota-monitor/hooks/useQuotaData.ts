import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getQuotaMonitor, getQuotaProviders } from "@/services/quota";

const QUOTA_MONITOR_REFETCH_INTERVAL_MS = 30_000;
const QUOTA_PROVIDERS_QUERY_KEY = ["quota-providers"] as const;
const QUOTA_MONITOR_QUERY_KEY = ["quota-monitor"] as const;

export function useQuotaProviders() {
  return useQuery({
    queryKey: QUOTA_PROVIDERS_QUERY_KEY,
    queryFn: ({ signal }) => getQuotaProviders({ signal }),
    staleTime: 5 * 60_000
  });
}

export function quotaMonitorQueryKey(provider: string, selectedUsername?: string | null) {
  const providerKey = provider || "muyuan";
  if (selectedUsername === undefined) {
    return [...QUOTA_MONITOR_QUERY_KEY, providerKey] as const;
  }

  return [...QUOTA_MONITOR_QUERY_KEY, providerKey, selectedUsername || null] as const;
}

export function useQuotaData(provider: string, selectedUsername?: string | null) {
  return useQuery({
    queryKey: quotaMonitorQueryKey(provider, selectedUsername ?? null),
    queryFn: ({ signal }) =>
      getQuotaMonitor({
        signal,
        provider,
        selectedUsername: selectedUsername || null
      }),
    refetchInterval: QUOTA_MONITOR_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    staleTime: 10_000
  });
}

export function useForceRefreshQuota(provider: string, selectedUsername?: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      getQuotaMonitor({
        force: true,
        provider,
        selectedUsername: selectedUsername || null
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: quotaMonitorQueryKey(provider)
      });
    }
  });
}
