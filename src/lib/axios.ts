import axios, { AxiosError, type AxiosResponse } from "axios";
import type { ApiEnvelope } from "@/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiEnvelope<unknown>>) => {
    const status = error.response?.status ?? 0;
    const message =
      error.response?.data?.message ||
      (status === 401
        ? "登录状态已失效，请重新认证"
        : status === 429
          ? "站点限流，请稍后重试"
          : error.response
            ? "接口请求失败"
            : "网络连接失败，请检查服务是否正常启动");

    console.error("API response error", {
      status,
      url: error.config?.url,
      method: error.config?.method,
      message
    });

    return Promise.reject(new ApiError(message, status));
  }
);

export function unwrapApiEnvelope<T>(response: AxiosResponse<ApiEnvelope<T>>) {
  const payload = response.data;

  if (!payload) {
    throw new ApiError("接口响应为空", response.status);
  }

  if (payload.success === false) {
    throw new ApiError(payload.message || "接口请求失败", response.status);
  }

  return payload.data;
}
