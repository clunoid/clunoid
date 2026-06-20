import { createGroq } from "@ai-sdk/groq";
import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Provider clients. Groq is free + extremely fast (routing, chat, light tasks).
 * Anthropic Claude handles demanding reasoning (math, careful explanations).
 */
export const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
export const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Model tiers — escalate only when a task truly needs it (cost discipline). */
export const MODELS = {
  /** Free, very fast, high rate limits: routing, chat, quick replies. */
  fast: () => groq("llama-3.1-8b-instant"),
  /** Cheap + accurate Claude: math, fact-grounding, structured explanations. */
  smart: () => anthropic("claude-haiku-4-5-20251001"),
} as const;

export const hasGroq = () => !!process.env.GROQ_API_KEY;
export const hasAnthropic = () => !!process.env.ANTHROPIC_API_KEY;
