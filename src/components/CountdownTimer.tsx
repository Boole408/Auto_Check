import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatCountdown } from "@/lib/formatters";

interface CountdownTimerProps {
  targetTime?: string | null;
  className?: string;
  fallback?: ReactNode;
}

export function CountdownTimer({
  targetTime,
  className,
  fallback = null
}: CountdownTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!targetTime) return;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [targetTime]);

  const countdown = useMemo(
    () => formatCountdown(targetTime, now),
    [targetTime, now]
  );

  if (!countdown) {
    return fallback == null ? null : <span className={className}>{fallback}</span>;
  }

  return <span className={className}>{countdown}</span>;
}
