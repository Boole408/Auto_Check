import { apiClient, unwrapApiEnvelope } from "@/lib/axios";
import type { ApiEnvelope, CheckinAllResult, CheckinScope, QuotaDashboard } from "@/types";

export async function getQuotaMonitor(options: {
  signal?: AbortSignal;
  force?: boolean;
  selectedUsername?: string | null;
} = {}) {
  const params = new URLSearchParams();
  if (options.force) {
    params.set("force", "1");
  }
  if (options.selectedUsername) {
    params.set("selected", options.selectedUsername);
  }

  const search = params.toString();
  const response = await apiClient.get<ApiEnvelope<QuotaDashboard>>(
    `/api/quota-monitor${search ? `?${search}` : ""}`,
    {
      signal: options.signal
    }
  );

  return unwrapApiEnvelope(response);
}

export async function checkinAll(scope: CheckinScope = "all") {
  const response = await apiClient.post<ApiEnvelope<CheckinAllResult>>("/api/quota-monitor/checkin-all", {
    scope
  });

  return unwrapApiEnvelope(response);
}
