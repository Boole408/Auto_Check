import { apiClient, unwrapApiEnvelope } from "@/lib/axios";
import type { ApiEnvelope, AuthConfig, AuthSession, LoginResult } from "@/types";

export async function getAuthConfig() {
  const response = await apiClient.get<ApiEnvelope<AuthConfig>>("/api/auth/config");
  return unwrapApiEnvelope<AuthConfig>(response);
}

export async function getAuthSession() {
  const response = await apiClient.get<ApiEnvelope<AuthSession>>("/api/auth/session");
  return unwrapApiEnvelope<AuthSession>(response);
}

export async function login(password: string) {
  const response = await apiClient.post<ApiEnvelope<LoginResult>>("/api/auth/login", { password });
  return unwrapApiEnvelope<LoginResult>(response);
}

export async function logout() {
  const response = await apiClient.post<ApiEnvelope<AuthSession>>("/api/auth/logout");
  return unwrapApiEnvelope<AuthSession>(response);
}
