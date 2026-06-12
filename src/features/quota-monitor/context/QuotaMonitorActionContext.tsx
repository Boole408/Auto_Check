import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren
} from "react";
import { useCheckin } from "@/features/quota-monitor/hooks/useCheckin";
import type { AccountQuota, CheckinScope } from "@/types";

interface QuotaMonitorActionContextValue {
  handleSingleCheckin: (account: AccountQuota) => Promise<void>;
  handleCheckinAll: (scope: CheckinScope) => Promise<void>;
  workingAccount: string | null;
  workingScope: CheckinScope | null;
}

const QuotaMonitorActionContext = createContext<QuotaMonitorActionContextValue | null>(null);

interface QuotaMonitorActionProviderProps extends PropsWithChildren {
  provider?: string;
  onNotice?: (message: string) => void;
}

export function QuotaMonitorActionProvider({
  children,
  provider = "muyuan",
  onNotice
}: QuotaMonitorActionProviderProps) {
  const {
    handleSingleCheckin,
    handleCheckinAll,
    workingAccount,
    workingScope
  } = useCheckin({ provider, onNotice });

  const value = useMemo<QuotaMonitorActionContextValue>(
    () => ({
      handleSingleCheckin,
      handleCheckinAll,
      workingAccount,
      workingScope
    }),
    [handleSingleCheckin, handleCheckinAll, workingAccount, workingScope]
  );

  return (
    <QuotaMonitorActionContext.Provider value={value}>
      {children}
    </QuotaMonitorActionContext.Provider>
  );
}

export function useQuotaMonitorActions() {
  const context = useContext(QuotaMonitorActionContext);

  if (!context) {
    throw new Error("useQuotaMonitorActions must be used within QuotaMonitorActionProvider");
  }

  return context;
}
