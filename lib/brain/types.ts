import type { Experience } from "./scene";

/** A compact conversational turn (we keep only a short rolling window). */
export type Turn = { role: "user" | "isaac"; content: string };

/** Grounding context assembled server-side before calling a model. */
export type BrainContext = {
  user?: { name?: string; isAuthed: boolean; email?: string; createdAt?: string };
  /** Long-term facts recalled about the user. */
  memory?: string;
  /** Rolling summary of the current conversation. */
  summary?: string;
  /** The real current moment + the user's locale (for accurate date/time). */
  now?: string;
  timezone?: string;
  locale?: string;
  /** Coarse location for personalization, if known. */
  location?: string;
};

/** Accurate client-side time/locale the browser knows. */
export type ClientContext = {
  now?: string;
  timezone?: string;
  locale?: string;
};

/** What the client sends to /api/brain. */
export type BrainRequest = {
  /** The kind of interaction — lets us grade games locally and route cheaply. */
  kind: "greeting" | "utterance" | "flag_guess" | "flag_next";
  /** The user's words (for utterance / flag_guess). */
  text?: string;
  /** Short rolling window of recent turns for grounding. */
  history?: Turn[];
  /** The experience currently on the Stage, if any (e.g. the active flag). */
  experience?: (Partial<Experience> & { type: string }) | null;
  /** Lightweight user state from the client. */
  user?: { name?: string; isAuthed: boolean; email?: string; createdAt?: string };
  /** Accurate time/locale from the browser. */
  client?: ClientContext;
};
