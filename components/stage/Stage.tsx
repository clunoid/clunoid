"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send } from "lucide-react";
import { useClunoid } from "@/lib/store/useClunoid";
import { useSpeechInput } from "@/lib/voice/useSpeechInput";
import { useMicLevel } from "@/lib/voice/useMicLevel";
import { looksLikeCountryGuess } from "@/lib/data/countries";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { IsaacOrb } from "./IsaacOrb";
import { SceneRenderer } from "./SceneRenderer";
import { Caption } from "./Caption";
import { AuthPrompt } from "@/components/auth/AuthPrompt";
import { ProfileMenu } from "@/components/auth/ProfileMenu";
import { cn } from "@/lib/utils";

export function Stage() {
  const isaac = useClunoid((s) => s.isaac);
  const started = useClunoid((s) => s.started);
  const isAuthed = useClunoid((s) => s.user.isAuthed);
  const { greet, send, submitGuess, setUser, setMicLevel } = useClunoid.getState();

  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const bufferRef = useRef(""); // accumulates the user's full utterance
  const silenceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Restore the session on load and keep it in sync (handles OAuth return,
  // sign-out, refresh — Supabase persists the session in the browser).
  useEffect(() => {
    const supabase = getSupabaseBrowser();

    async function hydrate(authUser: { id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> } | null) {
      if (!authUser) {
        setUser({ isAuthed: false });
        return;
      }
      let name =
        (authUser.user_metadata?.name as string) || (authUser.user_metadata?.full_name as string) || undefined;
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", authUser.id)
          .maybeSingle();
        if (profile?.display_name) name = profile.display_name as string;
      } catch {
        /* ignore */
      }
      const avatarUrl =
        (authUser.user_metadata?.avatar_url as string) || (authUser.user_metadata?.picture as string) || undefined;
      setUser({
        id: authUser.id,
        name,
        email: authUser.email,
        avatarUrl,
        createdAt: authUser.created_at,
        isAuthed: true,
      });
    }

    // Use getSession() — it reads the locally-stored session (fast, no network),
    // so the UI is never blocked on a slow/unreachable auth server.
    supabase.auth
      .getSession()
      .then(({ data }) => hydrate(data.session?.user ?? null))
      .finally(() => setAuthChecked(true));
    // Safety net: never leave the app stuck on the loading screen.
    const t = setTimeout(() => setAuthChecked(true), 2000);
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => hydrate(session?.user ?? null));
    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, [setUser]);

  // Signed-in users skip the "Meet Isaac" gate — drop them straight into the app.
  useEffect(() => {
    if (authChecked && isAuthed && !started) greet();
  }, [authChecked, isAuthed, started, greet]);

  function handleInput(text: string) {
    setInterim("");
    const inFlagGame = useClunoid.getState().experience?.type === "flag_quiz";
    if (inFlagGame && looksLikeCountryGuess(text)) submitGuess(text);
    else send(text);
  }

  const { supported, enable, disable } = useSpeechInput({
    // Accumulate the user's FULL utterance (however short or long) and submit it
    // only after a brief pause — Clunoid listens patiently until they're done.
    // Isaac's own voice is kept out: ignored while he speaks, and echo-filtered.
    onFinal: (t) => {
      const st = useClunoid.getState();
      if (st.isaac !== "idle" || st.isEcho(t)) return;
      bufferRef.current = (bufferRef.current + " " + t).trim();
      setInterim(bufferRef.current);
      resetSilence();
    },
    onInterim: (t) => {
      const st = useClunoid.getState();
      if (st.isaac !== "idle" || st.isEcho(t)) return;
      setInterim((bufferRef.current + " " + t).trim());
      resetSilence();
    },
  });

  // Orb ripples react to the user's voice while they speak.
  const handleLevel = useCallback((v: number) => setMicLevel(v), [setMicLevel]);

  useMicLevel(started && micOn, handleLevel);

  // Listening stays ON continuously while the mic is enabled (no stop/start
  // churn → never drops out). Isaac's own voice is filtered out two ways: we
  // ignore results while he speaks (below) and the store rejects any transcript
  // matching his recent lines (no echo loop).
  // Mute the mic WHILE Isaac speaks/thinks (recognizer fully off → it literally
  // cannot hear him → no echo, no self-interrupt). Re-arm shortly after he's
  // idle (cooldown lets his audio tail die out first). The watchdog keeps it
  // alive while idle so listening never silently drops.
  useEffect(() => {
    if (!supported || !micOn) {
      disable();
      return;
    }
    if (isaac === "idle") {
      const t = setTimeout(() => enable(), 450);
      return () => clearTimeout(t);
    }
    disable();
  }, [supported, micOn, isaac, enable, disable]);

  // After the user pauses, submit the whole utterance and auto-mute (mic returns
  // to muted; they tap to talk again).
  function resetSilence() {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    silenceRef.current = setTimeout(finishUtterance, 1700);
  }
  function finishUtterance() {
    if (silenceRef.current) {
      clearTimeout(silenceRef.current);
      silenceRef.current = undefined;
    }
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    setInterim("");
    disable();
    setMicOn(false); // auto-mute once they're done
    setMicLevel(0);
    if (text) handleInput(text);
  }

  function meetIsaac() {
    greet(); // mic stays MUTED by default — the user taps the mic to talk.
  }

  function toggleMic() {
    if (micOn) {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      bufferRef.current = "";
      setInterim("");
      disable();
      setMicOn(false);
      setMicLevel(0);
    } else {
      // Unmute = take over: stop Isaac if he's mid-thought/speech, then listen.
      const st = useClunoid.getState();
      if (st.isaac !== "idle") st.interrupt();
      bufferRef.current = "";
      setMicOn(true);
      enable();
    }
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    handleInput(t);
  }

  // Brief loading while we check the saved session (avoids a flash of the gate).
  if (!authChecked) {
    return (
      <main className="stage-bg grid min-h-[100dvh] place-items-center">
        <IsaacOrb size={120} />
      </main>
    );
  }

  // ── Welcome gate — only for brand-new / signed-out visitors ───────────────
  if (!started && !isAuthed) {
    return (
      <main className="stage-bg grid min-h-[100dvh] place-items-center px-6">
        <div className="flex max-w-md flex-col items-center text-center">
          <IsaacOrb size={170} />
          <h1 className="mt-8 font-serif text-5xl text-ink">Clunoid</h1>
          <p className="mt-3 text-ink-muted">
            Meet Isaac — a super-intelligent companion who can show you anything,
            play with you, and think out loud, just by talking.
          </p>
          <button
            onClick={meetIsaac}
            className="mt-8 rounded-full bg-clay px-8 py-4 text-lg font-medium text-[#1F1E1C] shadow-glow transition hover:bg-clay-soft"
          >
            Meet Isaac
          </button>
          <p className="mt-4 text-xs text-ink-faint">
            Tap the mic to talk — Clunoid listens until you're done, then prepares.
          </p>
        </div>
      </main>
    );
  }

  // ── Live Stage: orb is an unbounded BACKGROUND; everything renders over it ──
  return (
    <main className="stage-bg relative h-[100dvh] w-screen overflow-hidden">
      {/* Isaac's orb — fixed in the background, never pushed by content */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <IsaacOrb size={240} />
      </div>

      {/* Foreground column spans the full width, edge to edge */}
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between px-5 py-4">
          <span className="font-serif text-lg text-ink/80">clunoid</span>
          <ProfileMenu />
        </div>

        {/* Content (cards / steps / flags) — full width & height, scrolls if tall, over the orb */}
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-6 sm:px-8">
          <SceneRenderer />
        </div>

        {/* Bottom bar: mic far-left · input stretches · send far-right */}
        <form
          onSubmit={submitTyped}
          className="flex shrink-0 items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 sm:gap-4 sm:px-6"
        >
          {(() => {
            const listening = micOn && isaac === "idle";
            const paused = micOn && isaac !== "idle"; // auto-muted while Isaac talks
            return (
              <button
                type="button"
                onClick={toggleMic}
                disabled={!supported}
                className={cn(
                  "grid h-12 w-12 shrink-0 place-items-center rounded-full transition sm:h-14 sm:w-14",
                  listening && "bg-clay/20 text-clay ring-1 ring-clay/50",
                  paused && "bg-surface text-ink-faint opacity-60 ring-1 ring-border",
                  !micOn && "bg-surface text-ink hover:bg-surface-2",
                  !supported && "cursor-not-allowed opacity-40"
                )}
                aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                title={
                  !supported
                    ? "Voice not supported — type instead"
                    : paused
                    ? "Mic muted while Isaac is speaking"
                    : listening
                    ? "Listening — just talk"
                    : "Microphone off — tap to talk"
                }
              >
                {listening ? <Mic size={22} /> : <MicOff size={22} />}
              </button>
            );
          })()}

          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type to Isaac"
            className="h-12 min-w-0 flex-1 rounded-full border border-border bg-surface/80 px-5 text-ink outline-none backdrop-blur placeholder:text-ink-faint focus:border-clay sm:h-14"
          />

          <button
            type="submit"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface text-ink transition hover:bg-surface-2 sm:h-14 sm:w-14"
            aria-label="Send"
          >
            <Send size={20} />
          </button>
        </form>
      </div>

      {/* Captions float as an overlay (no reserved section) so cards get the full screen */}
      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
        <Caption interim={interim} />
      </div>

      <AuthPrompt />
    </main>
  );
}
