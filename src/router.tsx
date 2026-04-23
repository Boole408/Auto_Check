import { useEffect, useState } from "react";
import QuotaMonitorPage from "@/pages/QuotaMonitorPage";

const DEFAULT_ROUTE = "/quota-monitor";

export function Router() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", DEFAULT_ROUTE);
      setPath(DEFAULT_ROUTE);
    }

    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (path === DEFAULT_ROUTE || path === "/") {
    return <QuotaMonitorPage />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center text-foreground">
      <div>
        <p className="text-sm uppercase tracking-[0.4em] text-muted-foreground">404</p>
        <h1 className="mt-4 text-3xl font-semibold">页面不存在</h1>
        <button
          className="mt-6 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => {
            window.history.pushState(null, "", DEFAULT_ROUTE);
            setPath(DEFAULT_ROUTE);
          }}
        >
          返回额度看板
        </button>
      </div>
    </main>
  );
}
