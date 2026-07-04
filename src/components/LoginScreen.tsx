import { useState } from "react";
import { login, type Admin } from "../auth";
import Portal from "./Portal";

type Props = {
  onAuthenticated: (admin: Admin) => void;
  onClearError?: () => void;
  initialError?: string | null;
};

export default function LoginScreen({ onAuthenticated, onClearError, initialError }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>(() => initialError ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  // Forward an internal "error cleared" event up so the parent can
  // dismiss any authError it passed in.
  const clearError = () => {
    setError("");
    onClearError?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await login(email, password, rememberMe);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAuthenticated(result.admin);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950 px-4 text-white">
      <div className="login-glow pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
      <div className="login-glow pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />

      <div className="relative w-full max-w-md rounded-3xl border border-amber-300/30 bg-gradient-to-br from-zinc-900/95 via-zinc-950/95 to-cyan-950/30 p-6 shadow-[0_30px_90px_-25px_rgba(251,191,36,0.45)] backdrop-blur-xl sm:p-7">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="relative h-16 w-16">
            <div className="absolute inset-0 rounded-2xl bg-amber-500/40 blur-md animate-pulse" />
            <div className="relative flex h-full w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-3xl font-black text-black">
              S
            </div>
          </div>
          <h1 className="mt-3 text-xl font-extrabold tracking-wide text-amber-50">Personal Training Database</h1>
          <p className="mt-0.5 text-xs text-cyan-200/80">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearError();
              }}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-amber-200/80">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError();
                }}
                placeholder="••••••••"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 pr-12 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] text-zinc-300 hover:border-amber-300/40 hover:text-amber-200"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-amber-500 focus:ring-amber-400"
              />
              Remember me
            </label>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-xs text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline"
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 py-2.5 text-sm font-bold text-black transition hover:from-amber-400 hover:to-amber-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>

      {showForgot && (
        <Portal>
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
            onClick={() => setShowForgot(false)}
          >
            <div
              className="w-full max-w-xs rounded-2xl border border-zinc-700 bg-zinc-950 p-4 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-white">Forgot password</p>
              <p className="mt-1 text-xs text-zinc-400">
                In dummy mode, contact the Super Admin to reset your password. In production, a reset link will be sent to your email.
              </p>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
              />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowForgot(false)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-200"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (forgotEmail) {
                      window.alert(`If an account exists for ${forgotEmail}, password reset instructions have been sent.`);
                    }
                    setShowForgot(false);
                  }}
                  className="rounded-lg bg-amber-500 py-2 text-sm font-semibold text-black"
                >
                  Send link
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      <style>{`
        @keyframes loginGlow {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        .login-glow { animation: loginGlow 4s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
