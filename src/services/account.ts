import { apiClient, unwrapApiEnvelope } from "@/lib/axios";
import type { ApiEnvelope, CheckinResult, ImportAccountsResult } from "@/types";

export async function checkinAccount(username: string) {
  const response = await apiClient.post<ApiEnvelope<CheckinResult>>(
    `/api/quota-monitor/accounts/${encodeURIComponent(username)}/checkin`
  );

  return unwrapApiEnvelope(response);
}

export async function importAccounts(payload: {
  content: string;
  format?: "txt" | "json" | "auto";
}) {
  const response = await apiClient.post<ApiEnvelope<ImportAccountsResult>>(
    "/api/quota-monitor/accounts/import",
    payload
  );

  return unwrapApiEnvelope(response);
}
