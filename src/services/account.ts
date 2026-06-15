import { apiClient, unwrapApiEnvelope } from "@/lib/axios";
import type {
  ApiEnvelope,
  CheckinResult,
  DeleteAccountResult,
  ImportAccountsResult
} from "@/types";

function providerQuery(provider = "muyuan") {
  return `?provider=${encodeURIComponent(provider)}`;
}

export async function checkinAccount(username: string, provider = "muyuan") {
  const response = await apiClient.post<ApiEnvelope<CheckinResult>>(
    `/api/quota-monitor/accounts/${encodeURIComponent(username)}/checkin${providerQuery(provider)}`
  );

  return unwrapApiEnvelope(response);
}

export async function importAccounts(payload: {
  content: string;
  provider?: string;
  format?: "txt" | "json" | "auto";
}) {
  const response = await apiClient.post<ApiEnvelope<ImportAccountsResult>>(
    "/api/quota-monitor/accounts/import",
    {
      ...payload,
      provider: payload.provider || "muyuan"
    }
  );

  return unwrapApiEnvelope(response);
}

export async function deleteAccount(username: string, provider = "muyuan") {
  const response = await apiClient.delete<ApiEnvelope<DeleteAccountResult>>(
    `/api/quota-monitor/accounts/${encodeURIComponent(username)}${providerQuery(provider)}`
  );

  return unwrapApiEnvelope(response);
}
