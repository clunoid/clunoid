"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SpeechPlayer } from "@/lib/voice/speech";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Scene, Experience, ExplainerExperience, CalculationExperience } from "@/lib/brain/scene";
import type { BrainRequest, Turn } from "@/lib/brain/types";
import {
  autocorrectCountry,
  isCorrectGuess,
  pickCountry,
  flagUrl,
  type Country,
} from "@/lib/data/countries";

export type IsaacState = "idle" | "thinking" | "speaking";
type UserState = {
  id?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  createdAt?: string;
  isAuthed: boolean;
};
export type GuessFeedback = { said: string; correct: boolean; answer: string };

// Varied, instant flag reactions (no model round-trip → no lag).
const CORRECT_LINES: ((a: string) => string)[] = [
  (a) => `Yes! That's ${a}.`,
  (a) => `Spot on — ${a}!`,
  (a) => `Correct, it's ${a}!`,
  (a) => `Nailed it — ${a}!`,
];
const WRONG_LINES: ((a: string) => string)[] = [
  (a) => `Not quite — that's ${a}.`,
  (a) => `Close! It was ${a}.`,
  (a) => `Actually, that's ${a}.`,
  (a) => `Good try — it's ${a}.`,
];
const pickLine = (lines: ((a: string) => string)[], a: string) =>
  lines[Math.floor(Math.random() * lines.length)](a);

function clientCtx() {
  try {
    return {
      now: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
    };
  } catch {
    return { now: new Date().toISOString() };
  }
}

function nextFlagExperience(avoidCode: string | undefined, round: number, score: number): Experience {
  const c = pickCountry(avoidCode);
  return {
    type: "flag_quiz",
    flagUrl: flagUrl(c.code),
    code: c.code,
    answer: c.name,
    aliases: c.aliases ?? [],
    round,
    score,
  };
}

type ClunoidStore = {
  isaac: IsaacState;
  caption: string;
  spokenChars: number; // how many chars of `caption` have been voiced (for highlight)
  explainerIndex: number; // current beat in an explainer playback
  amplitude: number; // Isaac's voice level (speaking)
  micLevel: number; // user's voice level (listening)
  experience: Experience | null;
  history: Turn[];
  expectsInput: Scene["expectsInput"];
  user: UserState;
  started: boolean;
  authOpen: boolean;
  authMode: "signup" | "login";
  profileOpen: boolean;
  guessFeedback: GuessFeedback | null; // flag reveal: what you said + right/wrong + answer

  setUser: (u: UserState) => void;
  setMicLevel: (v: number) => void;
  openAuth: (mode: "signup" | "login") => void;
  closeAuth: () => void;
  openProfile: () => void;
  closeProfile: () => void;
  signOut: () => Promise<void>;
  /** Tell the brain an account state just changed, so Isaac responds in real time. */
  announceAuth: (event: "signed_up" | "signed_in" | "signed_out") => Promise<void>;

  greet: () => Promise<void>;
  send: (text: string) => Promise<void>;
  submitGuess: (text: string) => void;
  next: () => void;
  interrupt: () => void;
  isEcho: (text: string) => boolean; // true if transcript is Isaac's own voice
};

let player: SpeechPlayer | null = null;
let playSeq = 0; // bumps to cancel any in-flight playback (explainer beats / speech)
function getPlayer(set: (p: Partial<ClunoidStore>) => void): SpeechPlayer {
  if (!player) player = new SpeechPlayer((amp) => set({ amplitude: amp }));
  return player;
}

async function postBrain(req: BrainRequest): Promise<Scene> {
  const res = await fetch("/api/brain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("brain failed");
  return (await res.json()) as Scene;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

/** Everything Isaac is currently or recently saying (line + full explainer script + recent turns). */
function isaacCorpus(s: { caption: string; experience: Experience | null; history: Turn[] }): string {
  const parts = [s.caption];
  if (s.experience?.type === "explainer") parts.push(...s.experience.beats.map((b) => b.say));
  parts.push(...s.history.filter((h) => h.role === "isaac").slice(-4).map((h) => h.content));
  return norm(parts.join(" "));
}

/**
 * Is this transcript just Isaac's own voice echoing back? A phrase of 2+ words
 * (or a long single word) that is fully contained in what Isaac is saying is an
 * echo — ignored entirely (not shown, not sent). Short words pass through so
 * real one-word answers aren't blocked.
 */
function textIsEcho(text: string, corpus: string): boolean {
  const t = norm(text);
  if (!t || !corpus) return false;
  const wc = t.split(" ").length;
  return corpus.includes(t) && (wc >= 2 || t.length >= 10);
}

export const useClunoid = create<ClunoidStore>()(
  persist(
    (set, get) => {
  function stopPlayback() {
    playSeq++; // invalidate any in-flight explainer/speech loop
    getPlayer(set).stop();
  }

  // Narrate an explainer beat-by-beat from `start` (visuals sync to each beat).
  async function playExplainerFrom(exp: ExplainerExperience, start: number, seq: number) {
    for (let i = Math.max(0, start); i < exp.beats.length; i++) {
      if (seq !== playSeq) return; // superseded / interrupted
      set({ caption: exp.beats[i].say, spokenChars: 0, explainerIndex: i, isaac: "speaking" });
      await getPlayer(set).play(exp.beats[i].say, (c) => set({ spokenChars: c }));
    }
  }

  // Teach a calculation step-by-step — each step's card reveals as Isaac says it
  // (same synced-playback model as the explainer; explainerIndex = current step).
  async function playCalculationFrom(calc: CalculationExperience, start: number, seq: number) {
    // A brief intro (what this is + what we're finding) plays first, with no step
    // card highlighted yet (index -1 → just the context/media on the left show).
    if (start < 0) {
      if (calc.intro) {
        set({ caption: calc.intro, spokenChars: 0, explainerIndex: -1, isaac: "speaking" });
        await getPlayer(set).play(calc.intro, (c) => set({ spokenChars: c }));
        if (seq !== playSeq) return;
      }
      start = 0;
    }
    for (let i = Math.max(0, start); i < calc.steps.length; i++) {
      if (seq !== playSeq) return; // superseded / interrupted
      set({ caption: calc.steps[i].say, spokenChars: 0, explainerIndex: i, isaac: "speaking" });
      await getPlayer(set).play(calc.steps[i].say, (c) => set({ spokenChars: c }));
    }
  }

  async function applyScene(scene: Scene) {
    const seq = ++playSeq;
    const exp = scene.experience ?? null;
    const newExplainer = !scene.keep && exp?.type === "explainer" ? exp : null;
    const newCalc = !scene.keep && exp?.type === "calculation" ? exp : null;
    set((s) => ({
      caption: newExplainer
        ? newExplainer.beats[0]?.say ?? scene.say
        : newCalc
        ? newCalc.intro ?? newCalc.steps[0]?.say ?? scene.say
        : scene.say,
      spokenChars: 0,
      explainerIndex: scene.keep ? s.explainerIndex : newCalc?.intro ? -1 : 0,
      guessFeedback: null,
      // Replace the Stage with the new experience, UNLESS it's a short interactive
      // reply (keep) — then leave the current content on screen.
      experience: scene.keep ? s.experience : exp,
      expectsInput: scene.expectsInput,
      history: [...s.history, { role: "isaac" as const, content: scene.say }].slice(-14),
      isaac: "speaking",
      authOpen: scene.auth ? true : s.authOpen,
      authMode: scene.auth ?? s.authMode,
      // Identity questions ("what's my name?") pop the profile open.
      profileOpen: scene.showProfile ? true : s.profileOpen,
    }));

    // Auto-close the profile a few seconds after Isaac opens it, so it never
    // lingers over the cards/media.
    if (scene.showProfile) {
      setTimeout(() => set({ profileOpen: false }), 6500);
    }

    if (newExplainer) {
      await playExplainerFrom(newExplainer, 0, seq);
    } else if (newCalc) {
      await playCalculationFrom(newCalc, newCalc.intro ? -1 : 0, seq);
    } else {
      // A short interactive reply (acknowledgement / question).
      await getPlayer(set).play(scene.say, (chars) => set({ spokenChars: chars }));
      // Then pick up the explainer exactly where Isaac left off (continue / react).
      if (scene.resume && seq === playSeq) {
        const cur = get().experience;
        if (cur?.type === "explainer") await playExplainerFrom(cur, get().explainerIndex, seq);
      }
    }
    if (seq === playSeq) set({ isaac: "idle" });
  }

  async function run(req: BrainRequest, userTurn?: string) {
    stopPlayback(); // barge-in: stop any current speech / explainer
    set((s) => ({
      isaac: "thinking",
      amplitude: 0,
      history: userTurn ? [...s.history, { role: "user" as const, content: userTurn }].slice(-14) : s.history,
    }));
    try {
      const scene = await postBrain({
        ...req,
        history: get().history,
        experience: get().experience ?? null,
        authOpen: get().authOpen,
        user: get().user,
        client: clientCtx(),
      });
      await applyScene(scene);
    } catch {
      await applyScene({ say: "Say that once more for me?", expectsInput: "voice" });
    }
  }

  return {
    isaac: "idle",
    caption: "",
    spokenChars: 0,
    explainerIndex: 0,
    amplitude: 0,
    micLevel: 0,
    experience: null,
    history: [],
    expectsInput: "none",
    user: { isAuthed: false },
    started: false,
    authOpen: false,
    authMode: "signup",
    profileOpen: false,
    guessFeedback: null,

    setUser: (u) => set({ user: u }),
    setMicLevel: (v) => set({ micLevel: v }),
    openAuth: (mode) => set({ authOpen: true, authMode: mode }),
    closeAuth: () => set({ authOpen: false }),
    openProfile: () => set({ profileOpen: true }),
    closeProfile: () => set({ profileOpen: false }),
    signOut: async () => {
      // Acknowledge instantly: close the menu and stop whatever Isaac is mid-saying
      // (so a sign-out is felt right away, never ignored while he keeps talking).
      set({ profileOpen: false });
      stopPlayback();
      set({ isaac: "idle", amplitude: 0 });
      // Let the brain give a brief, natural goodbye — spoken WHILE we still know
      // who they are (run before clearing the session so the name is available).
      try {
        await run({ kind: "auth_event", event: "signed_out" });
      } catch {
        /* ignore — still sign out below */
      }
      try {
        await getSupabaseBrowser().auth.signOut();
      } catch {
        /* ignore */
      }
      set({ user: { isAuthed: false } });
    },

    announceAuth: async (event) => {
      // We're on the live Stage now (not the welcome gate), and the profile menu
      // must never linger open across an account change.
      set({ started: true, profileOpen: false });
      await run({ kind: "auth_event", event });
    },

    greet: async () => {
      if (get().started) return;
      set({ started: true });
      await run({ kind: "greeting" });
    },

    send: async (text) => {
      const s = get();
      const t = text.trim();
      if (!t) return;
      if (s.isaac === "thinking") return; // don't pile up requests mid-thought
      // (Voice echo is filtered at the source in the Stage; typed input is never echo.)
      await run({ kind: "utterance", text: t }, t);
    },

    // Flag answers run entirely on the client → instant, correctly synced, no lag.
    submitGuess: (text) => {
      const s = get();
      if (!text.trim() || s.isaac === "speaking") return;
      const e = s.experience;
      if (e?.type !== "flag_quiz") {
        void s.send(text);
        return;
      }
      const corrected = autocorrectCountry(text); // "pero" -> "Peru"
      const correct = isCorrectGuess(corrected, { name: e.answer, aliases: e.aliases } as Country);
      const newScore = e.score + (correct ? 1 : 0);
      const reaction = pickLine(correct ? CORRECT_LINES : WRONG_LINES, e.answer);

      // 1) Reveal the result on the CURRENT flag and speak the reaction.
      stopPlayback();
      set((st) => ({
        guessFeedback: { said: corrected, correct, answer: e.answer },
        caption: reaction,
        spokenChars: 0,
        isaac: "speaking",
        history: [
          ...st.history,
          { role: "user" as const, content: corrected },
          { role: "isaac" as const, content: reaction },
        ].slice(-14),
      }));

      // 2) Only AFTER Isaac finishes speaking, advance to the next flag.
      getPlayer(set)
        .play(reaction, (chars) => set({ spokenChars: chars }))
        .then(() => {
        if (get().experience?.type !== "flag_quiz") return; // user moved on mid-reaction
        set({
          isaac: "idle",
          caption: "",
          guessFeedback: null,
          experience: nextFlagExperience(e.code, e.round + 1, newScore),
        });
      });
    },

    next: () => {
      const e = get().experience;
      if (e?.type !== "flag_quiz") return;
      stopPlayback();
      set({
        isaac: "idle",
        caption: "",
        guessFeedback: null,
        experience: nextFlagExperience(e.code, e.round + 1, e.score),
      });
    },

    interrupt: () => {
      stopPlayback();
      set({ isaac: "idle", amplitude: 0 });
    },

    isEcho: (text) => textIsEcho(text, isaacCorpus(get())),
  };
    },
    {
      // Remember where we were so a refresh never sends the user back to the
      // start — the experience, progress (current step/beat), and conversation
      // are restored. Transient playback state (isaac/amplitude/mic) is NOT
      // persisted, so Isaac resumes idle and the user simply carries on.
      name: "clunoid-session",
      version: 1,
      partialize: (s) => ({
        experience: s.experience,
        explainerIndex: s.explainerIndex,
        history: s.history,
        started: s.started,
        expectsInput: s.expectsInput,
        caption: s.caption,
        spokenChars: s.spokenChars,
      }),
    }
  )
);
