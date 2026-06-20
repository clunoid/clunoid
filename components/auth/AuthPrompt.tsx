"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useClunoid } from "@/lib/store/useClunoid";

const EMAIL_KEY = "clunoid_email";

/**
 * Sign up / sign in with email+password or Google. The last-used email is
 * remembered and pre-filled so returning users just type their password.
 * (Email confirmation is disabled in Supabase, so sign-up logs in immediately.)
 */
export function AuthPrompt() {
  const open = useClunoid((s) => s.authOpen);
  const mode = useClunoid((s) => s.authMode);
  const close = useClunoid((s) => s.closeAuth);
  const setUser = useClunoid((s) => s.setUser);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Pre-fill the remembered email when the modal opens.
  useEffect(() => {
    if (open) {
      try {
        const saved = localStorage.getItem(EMAIL_KEY);
        if (saved) setEmail(saved);
      } catch {
        /* ignore */
      }
    }
  }, [open]);

  function remember(value: string) {
    try {
      localStorage.setItem(EMAIL_KEY, value);
    } catch {
      /* ignore */
    }
  }

  async function withGoogle() {
    setBusy(true);
    setMsg(null);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // Redirects to Google; the callback route finishes sign-in.
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Google sign-in failed.");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = getSupabaseBrowser();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (error) throw error;
        if (data.session && data.user) {
          await supabase.from("profiles").upsert({ id: data.user.id, display_name: name });
          remember(email);
          setUser({
            id: data.user.id,
            name,
            email: data.user.email,
            createdAt: data.user.created_at,
            isAuthed: true,
          });
          close();
        } else {
          setMsg("Check your email to confirm your account, then sign in.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        remember(email);
        const display =
          (data.user.user_metadata?.name as string) ||
          (data.user.user_metadata?.full_name as string) ||
          undefined;
        setUser({
          id: data.user.id,
          name: display,
          email: data.user.email,
          createdAt: data.user.created_at,
          isAuthed: true,
        });
        close();
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-soft"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl text-ink">
                {mode === "signup" ? "Let's get you set up" : "Welcome back"}
              </h2>
              <button onClick={close} className="text-ink-faint hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <button
              type="button"
              onClick={withGoogle}
              disabled={busy}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-base px-4 py-3 font-medium text-ink transition hover:bg-surface-2 disabled:opacity-60"
            >
              <GoogleIcon /> Continue with Google
            </button>

            <div className="mb-4 flex items-center gap-3 text-xs text-ink-faint">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              {mode === "signup" && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should Isaac call you?"
                  required
                  className="rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-clay"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                autoComplete="email"
                className="rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-clay"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                autoFocus={!!email}
                className="rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-clay"
              />

              {msg && <p className="text-sm text-clay-soft">{msg}</p>}

              <button
                type="submit"
                disabled={busy}
                className="mt-1 rounded-xl bg-clay px-4 py-3 font-medium text-[#1F1E1C] transition hover:bg-clay-soft disabled:opacity-60"
              >
                {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
              </button>
            </form>

            <button
              onClick={() => useClunoid.getState().openAuth(mode === "signup" ? "login" : "signup")}
              className="mt-4 w-full text-center text-sm text-ink-faint hover:text-ink"
            >
              {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.6 34.6 26.9 36 24 36c-5.2 0-9.6-3.3-11.2-7.9l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5C40.9 36.5 44 30.8 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
