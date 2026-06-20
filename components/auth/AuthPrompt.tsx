"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useClunoid } from "@/lib/store/useClunoid";

/**
 * Isaac triggers this conversationally. Email + password to start; on sign-up
 * we capture a name so Isaac can address the person and remember them.
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
          await supabase
            .from("profiles")
            .upsert({ id: data.user.id, display_name: name });
          setUser({ id: data.user.id, name, isAuthed: true });
          close();
        } else {
          setMsg("Check your email to confirm your account, then come back and sign in.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        const display = (data.user.user_metadata?.name as string) || undefined;
        setUser({ id: data.user.id, name: display, isAuthed: true });
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
              <button onClick={close} className="text-ink-faint hover:text-ink">
                <X size={18} />
              </button>
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
                className="rounded-xl border border-border bg-base px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-clay"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                minLength={6}
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
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
