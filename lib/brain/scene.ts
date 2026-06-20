import { z } from "zod";

/**
 * A Scene is the structured output of Isaac's brain. The frontend renders it.
 * The LLM never emits code — only this small, validated payload. That keeps
 * interactions fast, cheap, and safe.
 */

// ── Experiences (the things that can appear on the Stage) ──────────────

export const flagQuizSchema = z.object({
  type: z.literal("flag_quiz"),
  flagUrl: z.string().url(),
  /** ISO alpha-2 code of the shown flag (used to avoid immediate repeats). */
  code: z.string().optional(),
  /** Correct country name. Kept client-side for grading; never shown until reveal. */
  answer: z.string(),
  /** Accepted alternative spellings / short names. */
  aliases: z.array(z.string()).default([]),
  round: z.number().int().nonnegative().default(1),
  score: z.number().int().nonnegative().default(0),
});

export const mathStepsSchema = z.object({
  type: z.literal("math_steps"),
  title: z.string().optional(),
  /** Ordered solution steps, revealed one-by-one as Isaac narrates. */
  steps: z
    .array(
      z.object({
        /** KaTeX expression for this step (optional). */
        latex: z.string().optional(),
        /** Plain-language explanation of the step. */
        text: z.string(),
      })
    )
    .min(1),
  finalAnswer: z.string().optional(),
});

export const richCardSchema = z.object({
  type: z.literal("rich_card"),
  title: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  imageUrl: z.string().url().optional(),
});

/**
 * A narrated explainer: an ordered list of "beats". Each beat is a spoken
 * segment, optionally illustrated by an entity (a person / place / flag / thing)
 * whose image pops onto the Stage as Isaac mentions it — like an animated,
 * synced flowchart. Past beats' visuals shrink into a timeline.
 */
export const explainerEntitySchema = z.object({
  name: z.string(),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
  poster: z.string().url().optional(),
  caption: z.string().optional(),
  kind: z.enum(["person", "place", "flag", "concept", "thing"]).optional(),
});
export const explainerBeatSchema = z.object({
  say: z.string(),
  entity: explainerEntitySchema.optional(),
});
export const explainerSchema = z.object({
  type: z.literal("explainer"),
  title: z.string().optional(),
  beats: z.array(explainerBeatSchema).min(1),
});

export const experienceSchema = z.discriminatedUnion("type", [
  flagQuizSchema,
  mathStepsSchema,
  richCardSchema,
  explainerSchema,
]);

export type Experience = z.infer<typeof experienceSchema>;
export type FlagQuizExperience = z.infer<typeof flagQuizSchema>;
export type MathStepsExperience = z.infer<typeof mathStepsSchema>;
export type RichCardExperience = z.infer<typeof richCardSchema>;
export type ExplainerExperience = z.infer<typeof explainerSchema>;
export type ExplainerEntity = z.infer<typeof explainerEntitySchema>;

// ── The Scene envelope ─────────────────────────────────────────────────

export const sceneSchema = z.object({
  /** What Isaac says out loud (and shows as a caption). */
  say: z.string(),
  /** Optional experience to mount on the Stage. */
  experience: experienceSchema.optional(),
  /** If true, clear the current experience (Isaac is just talking now). */
  clear: z.boolean().optional(),
  /** If true, keep the current experience on screen (a short interactive reply). */
  keep: z.boolean().optional(),
  /** What kind of input Isaac is now waiting for. */
  expectsInput: z.enum(["voice", "text", "choice", "none"]).default("voice"),
  /** Whether Isaac wants to trigger the auth modal. */
  auth: z.enum(["signup", "login"]).optional(),
});

export type Scene = z.infer<typeof sceneSchema>;
