import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Sun,
  UserRound,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoginPageProps {
  username?: string;
  error?: string;
  loading?: boolean;
  onSubmit: (password: string) => Promise<void> | void;
}

export default function LoginPage({
  username = "admin",
  error = "",
  loading = false,
  onSubmit
}: LoginPageProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("cw-theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("cw-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextPassword = password.trim();
    if (!nextPassword || loading) return;

    void onSubmit(nextPassword);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(93,214,171,0.18),transparent_34%),linear-gradient(180deg,#F9FCFB_0%,#F1F7F4_100%)] text-foreground dark:bg-[radial-gradient(circle_at_top,rgba(54,154,121,0.18),transparent_28%),linear-gradient(180deg,#09120F_0%,#111D19_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-5rem] top-[-6rem] h-52 w-52 rounded-full bg-[#C8F3E5]/60 blur-[90px] dark:bg-[#184236]/60" />
        <div className="absolute right-[-4rem] top-20 h-64 w-64 rounded-full bg-[#E4FBF3]/80 blur-[110px] dark:bg-[#163127]/70" />
        <div className="absolute bottom-[-7rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#D6F7EB]/70 blur-[130px] dark:bg-[#12362B]/65" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
        <Button
          type="button"
          variant={darkMode ? "secondary" : "outline"}
          size="icon"
          className={cn(
            "absolute right-4 top-4 h-11 w-11 rounded-full border backdrop-blur-md sm:right-6 sm:top-6",
            darkMode
              ? "border-[#294038] bg-[rgba(19,31,27,0.9)] text-[#E6F7F0]"
              : "border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] text-[#245046]"
          )}
          onClick={() => setDarkMode((value) => !value)}
          aria-label={darkMode ? "切换到浅色模式" : "切换到深色模式"}
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <motion.section
          initial={{ opacity: 0, y: 22, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-[460px]"
        >
          <div className="absolute inset-0 rounded-[2rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.65),rgba(255,255,255,0.18))] opacity-70 blur-xl dark:bg-[linear-gradient(180deg,rgba(27,44,37,0.66),rgba(17,29,25,0.22))]" />

          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[rgba(255,255,255,0.78)] p-6 shadow-[0_24px_80px_rgba(18,46,38,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgba(16,26,22,0.82)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.34)] sm:p-8">
            <div className="absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.92),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.16),transparent)]" />

            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-[1.15rem] bg-[linear-gradient(135deg,#34C79A,#7BE3C2)] text-white shadow-[0_14px_34px_rgba(52,199,154,0.34)]">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6D857E] dark:text-[#8EA79F]">
                    Secure Access
                  </p>
                  <h1 className="mt-1 text-[1.9rem] font-black tracking-tight text-[#102A24] dark:text-[#ECF8F3]">
                    CW-Ops
                  </h1>
                </div>
              </div>

              <span className="rounded-full border border-[#D6E9E2] bg-[rgba(255,255,255,0.72)] px-3 py-1 text-[11px] font-semibold text-[#4E6A62] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.92)] dark:text-[#A9C4BB]">
                {username}
              </span>
            </div>

            <div className="mt-8 space-y-1">
              <p className="text-2xl font-semibold tracking-tight text-[#102A24] dark:text-[#ECF8F3]">
                输入密码
              </p>
              <p className="text-sm text-[#71867F] dark:text-[#8EA79F]">
                登录后进入控制台
              </p>
            </div>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6D857E] dark:text-[#8EA79F]">
                  账户
                </span>
                <div className="flex h-14 items-center gap-3 rounded-[1.2rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.88)]">
                  <UserRound className="h-4 w-4 text-[#22A77F]" />
                  <input
                    value={username}
                    readOnly
                    className="w-full border-none bg-transparent text-sm font-medium text-[#16352E] outline-none dark:text-[#E6F7F0]"
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6D857E] dark:text-[#8EA79F]">
                  密码
                </span>
                <div className="flex h-14 items-center gap-3 rounded-[1.2rem] border border-[#DDEAE5] bg-[rgba(255,255,255,0.72)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition focus-within:border-[#5AD0A6] focus-within:ring-2 focus-within:ring-[#5AD0A6]/20 dark:border-[#294038] dark:bg-[rgba(19,31,27,0.88)] dark:focus-within:border-[#4DBD95] dark:focus-within:ring-[#4DBD95]/20">
                  <LockKeyhole className="h-4 w-4 text-[#22A77F]" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    className="w-full border-none bg-transparent text-sm text-[#16352E] outline-none placeholder:text-[#93A7A1] dark:text-[#E6F7F0] dark:placeholder:text-[#71867F]"
                  />
                  <button
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-full text-[#6D857E] transition hover:bg-[#ECFBF6] hover:text-[#08785C] dark:text-[#8EA79F] dark:hover:bg-[#162620] dark:hover:text-[#ECF8F3]"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              <AnimatePresence initial={false}>
                {error ? (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="rounded-[1.15rem] border border-[#F2C8C8] bg-[rgba(255,246,246,0.92)] px-4 py-3 text-sm text-[#A33D3D] dark:border-[#5E2E2E] dark:bg-[rgba(60,24,24,0.7)] dark:text-[#F3BBBB]"
                  >
                    {error}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <Button
                type="submit"
                size="lg"
                className="h-14 w-full justify-center rounded-[1.2rem] text-sm font-semibold"
                disabled={loading || !password.trim()}
              >
                {loading ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    登录中
                  </>
                ) : (
                  <>
                    进入控制台
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </motion.section>
      </div>
    </main>
  );
}
