import { apiClient, unwrapApiEnvelope } from "@/lib/axios";
import type {
  ApiEnvelope,
  CheckinAllResult,
  CheckinScope,
  QuotaDashboard,
  QuotaProvidersResult
} from "@/types";

export async function getQuotaProviders(options: { signal?: AbortSignal } = {}) {
  const response = await apiClient.get<ApiEnvelope<QuotaProvidersResult>>(
    "/api/quota-monitor/providers",
    {
      signal: options.signal
    }
  );

  return unwrapApiEnvelope(response);
}

export async function getQuotaMonitor(options: {
  signal?: AbortSignal;
  provider?: string;
  force?: boolean;
  selectedUsername?: string | null;
} = {}) {
  const params = new URLSearchParams();
  if (options.provider) {
    params.set("provider", options.provider);
  }
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

export async function checkinAll(scope: CheckinScope = "all", provider = "muyuan") {
  const response = await apiClient.post<ApiEnvelope<CheckinAllResult>>(
    "/api/quota-monitor/checkin-all",
    {
      scope,
      provider
    }
  );

  return unwrapApiEnvelope(response);
}
