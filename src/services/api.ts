import type {
  ApiEnvelope,
  CheckinAllResult,
  CheckinResult,
  CheckinScope,
  ImportAccountsResult,
  QuotaDashboard
} from "@/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const fallback = response.status === 429 ? "站点限流，请稍后重试" : "接口请求失败";
    throw new ApiError(payload?.message || fallback, response.status);
  }

  if (!payload) {
    throw new ApiError("接口响应为空", response.status);
  }

  return payload.data;
}

export function getQuotaMonitor(options: {
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
  return request<QuotaDashboard>(`/api/quota-monitor${search ? `?${search}` : ""}`, {
    signal: options.signal
  });
}

export function checkinAccount(username: string) {
  return request<CheckinResult>(
    `/api/quota-monitor/accounts/${encodeURIComponent(username)}/checkin`,
    { method: "POST" }
  );
}

export function checkinAll(scope: CheckinScope = "all") {
  return request<CheckinAllResult>("/api/quota-monitor/checkin-all", {
    method: "POST",
    body: JSON.stringify({ scope })
  });
}

export function importAccounts(payload: {
  content: string;
  format?: "txt" | "json" | "auto";
}) {
  return request<ImportAccountsResult>("/api/quota-monitor/accounts/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
