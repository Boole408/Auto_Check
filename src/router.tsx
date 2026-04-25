import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ApiError } from "@/lib/axios";
import LoginPage from "@/pages/LoginPage";
import QuotaMonitorPage from "@/pages/QuotaMonitorPage";
import { getAuthConfig, getAuthSession, login, logout } from "@/services/auth";
import type { AuthSession } from "@/types";

const DEFAULT_ROUTE = "/quota-monitor";
const LOGIN_ROUTE = "/login";
const EMPTY_SESSION: AuthSession = {
  authenticated: false,
  username: null,
  expiresAt: null
};

export function Router() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [session, setSession] = useState<AuthSession>(EMPTY_SESSION);
  const [sessionReady, setSessionReady] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginUsername, setLoginUsername] = useState("admin");

  const navigate = useCallback((nextPath: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }

    setPath(nextPath);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await getAuthSession();
      setSession(nextSession);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.error("Failed to refresh session", error);
      }
      setSession(EMPTY_SESSION);
    } finally {
      setSessionReady(true);
    }
  }, []);

  const refreshAuthConfig = useCallback(async () => {
    try {
      const config = await getAuthConfig();
      setLoginUsername(config.username || "admin");
    } catch (error) {
      console.error("Failed to load auth config", error);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void refreshAuthConfig();
    void refreshSession();
  }, [refreshAuthConfig, refreshSession]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setSession(EMPTY_SESSION);
      setSessionReady(true);
      setLoginPending(false);
      setLogoutPending(false);
      setLoginError("登录状态已失效，请重新输入密码");
      navigate(LOGIN_ROUTE, true);
    };

    window.addEventListener("cw-auth-expired", handleAuthExpired as EventListener);
    return () => window.removeEventListener("cw-auth-expired", handleAuthExpired as EventListener);
  }, [navigate]);

  useEffect(() => {
    if (!sessionReady) return;

    if (path === "/") {
      navigate(session.authenticated ? DEFAULT_ROUTE : LOGIN_ROUTE, true);
      return;
    }

    if (!session.authenticated && path === DEFAULT_ROUTE) {
      navigate(LOGIN_ROUTE, true);
      return;
    }

    if (session.authenticated && path === LOGIN_ROUTE) {
      navigate(DEFAULT_ROUTE, true);
    }
  }, [navigate, path, session.authenticated, sessionReady]);

  const handleLogin = useCallback(
    async (password: string) => {
      if (!password) return;

      setLoginPending(true);
      setLoginError("");

      try {
        const result = await login(password);
        setSession({
          authenticated: result.authenticated,
          username: result.username,
          expiresAt: null
        });
        navigate(DEFAULT_ROUTE, true);
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "登录失败，请稍后重试";
        setLoginError(message);
      } finally {
        setLoginPending(false);
      }
    },
    [navigate]
  );

  const handleLogout = useCallback(async () => {
    setLogoutPending(true);

    try {
      await logout();
    } catch (error) {
      console.error("Failed to logout", error);
    } finally {
      setSession(EMPTY_SESSION);
      setLogoutPending(false);
      setLoginError("");
      navigate(LOGIN_ROUTE, true);
    }
  }, [navigate]);

  const fallbackTarget = useMemo(
    () => (session.authenticated ? DEFAULT_ROUTE : LOGIN_ROUTE),
    [session.authenticated]
  );

  if (!sessionReady) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-foreground">
        <div className="flex items-center gap-3 rounded-full border border-[#DDEAE5] bg-[rgba(255,255,255,0.8)] px-5 py-3 text-sm font-semibold shadow-[0_12px_30px_rgba(16,42,36,0.08)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)]">
          <LoaderCircle className="h-4 w-4 animate-spin text-[#20A77F]" />
          正在检查登录状态...
        </div>
      </main>
    );
  }

  if (path === LOGIN_ROUTE || (!session.authenticated && path === DEFAULT_ROUTE)) {
    return (
      <LoginPage
        username={loginUsername}
        loading={loginPending}
        error={loginError}
        onSubmit={handleLogin}
      />
    );
  }

  if (path === DEFAULT_ROUTE) {
    return (
      <QuotaMonitorPage
        currentUser={session.username || "admin"}
        isLoggingOut={logoutPending}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center text-foreground">
      <div>
        <p className="text-sm uppercase tracking-[0.4em] text-muted-foreground">404</p>
        <h1 className="mt-4 text-3xl font-semibold">页面不存在</h1>
        <button
          className="mt-6 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => navigate(fallbackTarget)}
        >
          {session.authenticated ? "返回控制台" : "返回登录页"}
        </button>
      </div>
    </main>
  );
}
