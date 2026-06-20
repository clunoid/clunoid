import { generateObject, generateText, type CoreMessage } from "ai";
import { z } from "zod";
import { MODELS, hasGroq, hasAnthropic } from "@/lib/models";
import { ISAAC_PERSONA, contextPreamble, stageState, dateLine } from "./prompts";
import type { BrainContext, BrainRequest, Turn } from "./types";
import type { Scene } from "./scene";
import {
  pickCountry,
  flagUrl,
  isCorrectGuess,
  findCountryByName,
  type Country,
} from "@/lib/data/countries";
import { fetchWiki } from "@/lib/data/wikipedia";
import { currentLeader } from "@/lib/data/wikidata";
import { webSearch, imageSearch, hasSearch } from "@/lib/data/search";
import { pexelsPhotos, pexelsVideos, hasPexels } from "@/lib/data/pexels";
import { commonsImage } from "@/lib/data/commons";

// ── Helpers ────────────────────────────────────────────────────────────

function toMessages(history: Turn[] = [], current?: string): CoreMessage[] {
  const msgs: CoreMessage[] = history.slice(-10).map((t) => ({
    role: t.role === "isaac" ? "assistant" : "user",
    content: t.content,
  }));
  if (current) msgs.push({ role: "user", content: current });
  return msgs;
}

function activeFlag(req: BrainRequest) {
  const e = req.experience;
  if (e?.type !== "flag_quiz") return null;
  return {
    answer: String(e.answer ?? ""),
    aliases: (e.aliases as string[]) ?? [],
    code: e.code as string | undefined,
    round: Number(e.round ?? 1),
    score: Number(e.score ?? 0),
  };
}

function buildFlagScene(country: Country, round: number, score: number, say: string): Scene {
  return {
    say,
    expectsInput: "voice",
    experience: {
      type: "flag_quiz",
      flagUrl: flagUrl(country.code),
      code: country.code,
      answer: country.name,
      aliases: country.aliases ?? [],
      round,
      score,
    },
  };
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, s.lastIndexOf(" ", max)) + "…";
}

async function isaacLine(system: string, messages: CoreMessage[], fallback: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: MODELS.fast(),
      system,
      messages,
      temperature: 0.85,
      maxTokens: 220,
      maxRetries: 1,
    });
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

// ── Fast decision via plain text + tolerant JSON parse (no slow structured mode) ──

type Decision = {
  say: string;
  action: "talk" | "fact" | "start_flags" | "math" | "signup" | "login" | "stop";
  query?: string;
  clear?: boolean;
};

function parseDecision(text: string): Decision | null {
  try {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a === -1 || b === -1) return null;
    const obj = JSON.parse(text.slice(a, b + 1));
    if (typeof obj.say !== "string" || typeof obj.action !== "string") return null;
    return obj as Decision;
  } catch {
    return null;
  }
}

async function decide(req: BrainRequest, ctx: BrainContext): Promise<Decision | null> {
  const system = `${ISAAC_PERSONA}${dateLine(ctx)}${contextPreamble(ctx)}${stageState(req.experience)}

Decide your reply and ONE action. Respond with ONLY a single-line JSON object, nothing else:
{"say":"...","action":"talk|fact|start_flags|math|signup|login|stop","query":"...","clear":false}

Actions:
- talk: ONLY pure conversation with no real-world subject — greetings, opinions, small talk, how you're doing. Put the reply in "say".
- fact: the user asks about ANY real-world subject — a person, place, country, organisation, event, landmark, concept, "tell me about / what is / who is / explain / describe X", or anything where recency/accuracy matters. Set "query" to the subject's name (for "who leads country X", set it to the country). This fetches verified info AND a related picture to show — so PREFER this whenever there's a concrete topic. Keep "say" brief; the grounded answer is spoken for you. NEVER answer facts from memory.
- start_flags: begin a flag-guessing game.
- math: a calculation or worked solution — set "query" to the problem.
- signup / login: account actions. stop: clear the Stage.
When in doubt between talk and fact, choose fact. Never guess at facts.`;

  try {
    const { text } = await generateText({
      model: MODELS.fast(),
      system,
      messages: toMessages(req.history, req.text),
      temperature: 0.4,
      maxTokens: 600,
      maxRetries: 1,
    });
    return parseDecision(text);
  } catch {
    return null;
  }
}

// ── Fact answer, grounded in current data (+ related image) ────────────

const OFFICEHOLDER =
  /\b(president|prime minister|pm|premier|chancellor|king|queen|monarch|emperor|pope|head of (state|government)|chief minister|first minister|governor|mayor|secretary[- ]general|ceo|chairman|leader)\b/i;
const CURRENTISH = /\b(who|current|currently|now|today|right now|these days|latest)\b/i;

function titleCase(s: string): string {
  return (s || "").trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) || "Here's what I found";
}

async function groundedSay(question: string, facts: string, ctx: BrainContext): Promise<string> {
  const system = `${ISAAC_PERSONA}${dateLine(
    ctx
  )}\nAnswer the user using ONLY the verified facts below — they are current and correct, even if they differ from what you remember. State them confidently in 1-3 spoken sentences. Report ONLY established facts — never present predictions, rumours, betting odds, or opinions as if they are settled facts. NEVER contradict the facts, and NEVER mention training data, knowledge cutoffs, or being an AI. Never refuse or say you can't show something that is public and legal — share what the facts give you. If the facts don't clearly cover it, say plainly that you're not certain rather than guessing.\nVerified facts: ${facts}`;
  // Use Claude when available — it reliably grounds on the facts instead of
  // hallucinating from stale memory (which a small model can do).
  try {
    const { text } = await generateText({
      model: hasAnthropic() ? MODELS.smart() : MODELS.fast(),
      system,
      messages: [{ role: "user", content: question }],
      temperature: 0.3,
      maxTokens: 220,
      maxRetries: 1,
    });
    return text.trim() || trim(facts, 180);
  } catch {
    return trim(facts, 180);
  }
}

// Reliable detection of "show me a card about a topic" questions, so we don't
// depend on the small router model remembering to use the fact path.
const FACTUAL_LEAD =
  /^(tell me (more )?about|tell me|what is|what are|what's|whats|who is|who's|whos|who are|who was|who were|explain|describe|where is|where are|when was|when is|when did|how (tall|big|old|far|deep|long|high|heavy) is|give me (some )?(info|information|facts) (on|about)|show me|show|find me|find|i want to see|let me see|can you show( me)?|get me)\b/i;
const MATHISH =
  /(\d+\s*[+\-*/×^]\s*\d+)|\b(plus|minus|times|divided by|multiplied|calculate|solve|derivative|integral|equation|square root|percent of)\b/i;
const PERSONAL = /\b(your|my)\b|\bthe (time|date|day|weather)\b/i;

// Anything time-sensitive / newsy → needs live web search, not static sources.
const CURRENTISH_Q =
  /\b(news|latest|today|tonight|yesterday|recent|recently|currently|now|right now|this (week|month|year|morning|evening)|happening|breaking|update|score|won|winning|result|price|stock|weather|election|released|launch|2024|2025|2026|2027)\b/i;

// Pure "what's the date / day / time" questions — answer from the client clock,
// never from web search (so the date is always the real one and matches Isaac).
const DATE_Q =
  /\btoday'?s date\b|\bwhat day is it\b|\bwhat time is it\b|\bwhen is today\b|^what'?s?(\s+is)?\s+(the\s+)?(date|time|day)\b/i;

// Identity questions → answer from the account and pop the profile open.
const IDENTITY_Q =
  /\b(what('?s| is)? my name|who am i|my account|my profile|my details|when did i (join|sign ?up|register|create)|do you (know|remember) (me|my name)|what do you know about me)\b/i;

function looksFactual(text: string): boolean {
  if (MATHISH.test(text) || PERSONAL.test(text)) return false;
  return FACTUAL_LEAD.test(text.trim());
}

function looksCurrent(text: string): boolean {
  if (MATHISH.test(text)) return false;
  return CURRENTISH_Q.test(text);
}

function extractTopic(text: string): string {
  const t = text.trim().replace(/[?.!]+$/, "");
  const m = t.match(FACTUAL_LEAD);
  let topic = (m ? t.slice(m[0].length) : t).replace(/^\s+/, "");
  // Strip media phrasing ("a photo of", "a video of", …) → just the subject.
  topic = topic.replace(/^(a |an |the |some )?(photo|picture|image|video|clip|pic|footage)s?\s+of\s+/i, "");
  return topic || t;
}

/**
 * Gather verified facts, then have Claude ground ONE answer. Isaac speaks it AND
 * the card shows it — single source of truth, so they can never disagree, and
 * nothing unverified (raw snippets, headlines, predictions) reaches the screen.
 * Order of evidence: live web search → Wikidata (current leaders) → Wikipedia.
 */
async function factScene(query: string, question: string, ctx: BrainContext): Promise<Scene> {
  // 1) Current national leader → Wikidata is AUTHORITATIVE. Skip web search here:
  //    stale articles (e.g. naming a former president) would otherwise confuse it.
  if (OFFICEHOLDER.test(question) && CURRENTISH.test(question)) {
    const role = /\b(prime minister|pm|head of government|chancellor|premier|first minister)\b/i.test(
      question
    )
      ? "gov"
      : "state";
    const name = (await currentLeader(question, role)) || (await currentLeader(query, role));
    if (name) {
      const bio = await fetchWiki(name);
      const facts = `DEFINITIVE current fact (verified, up to date): the current ${
        role === "gov" ? "head of government" : "head of state"
      } in question is ${name}. This is correct as of now — do not name anyone else.${
        bio ? ` Background: ${bio.extract}` : ""
      }`;
      const say = await groundedSay(question, facts, ctx);
      return {
        say,
        expectsInput: "voice",
        experience: { type: "rich_card", title: bio?.title || name, body: say, imageUrl: bio?.imageUrl },
      };
    }
  }

  // 2) Live web search (freshest — news, sports, prices, events) + a picture.
  const [search, wiki] = await Promise.all([
    hasSearch() ? webSearch(question) : Promise.resolve(null),
    fetchWiki(query || question),
  ]);
  let facts = "";
  if (search && (search.answer || search.results.length)) {
    facts =
      (search.answer ? `Summary: ${search.answer}\n` : "") +
      search.results.slice(0, 5).map((r) => `- ${trim(r.content, 320)}`).join("\n");
  } else if (wiki) {
    facts = `${wiki.title}: ${wiki.extract}`;
  }
  if (!facts) return chatReply(question, ctx, []);

  // ONE grounded answer → spoken by Isaac AND shown on the card (always in sync).
  const say = await groundedSay(question, facts, ctx);
  return {
    say,
    expectsInput: "voice",
    experience: {
      type: "rich_card",
      title: wiki?.title || titleCase(query || question),
      body: say,
      imageUrl: wiki?.imageUrl,
    },
  };
}

// ── Explainer: a synced visual narration (entity images appear as Isaac talks) ──

/** Resolve a named entity to an image: flag for countries, else Wikipedia photo. */
async function resolveEntityImage(
  name: string
): Promise<{ imageUrl?: string; caption?: string; kind?: "person" | "place" | "flag" | "concept" | "thing" }> {
  const country = findCountryByName(name);
  if (country) return { imageUrl: flagUrl(country.code), caption: country.name, kind: "flag" };

  const wiki = await fetchWiki(name);
  if (wiki?.imageUrl) return { imageUrl: wiki.imageUrl, caption: wiki.title, kind: "thing" };

  // Wikipedia has no image (common for company logos it treats as non-free) →
  // try Pexels, Commons, then web search so we still show a real logo/photo.
  if (hasPexels()) {
    const p = (await pexelsPhotos(name, 1))[0];
    if (p) return { imageUrl: p, caption: wiki?.title ?? name, kind: "thing" };
  }
  const c = await commonsImage(name);
  if (c) return { imageUrl: c, caption: wiki?.title ?? name, kind: "thing" };
  if (hasSearch()) {
    const img = await imageSearch(name);
    if (img) return { imageUrl: img, caption: wiki?.title ?? name, kind: "thing" };
  }
  return { caption: wiki?.title ?? name, kind: "thing" };
}

/**
 * Resolve a beat's media to the MOST RELEVANT real video/image — never a
 * placeholder. The brain's `type` chooses the strategy:
 *  - entity: one named real thing → its official image (flag/Wikipedia/logo).
 *  - photo:  a specific real scene/event/people/object → a real PHOTOGRAPH of
 *            exactly that (web image search → Commons → Wikipedia → stock photo).
 *  - clip:   a generic action/atmosphere → a stock VIDEO clip (Pexels).
 */
async function resolveBeatMedia(media: {
  query: string;
  type: "entity" | "photo" | "clip";
}): Promise<{ imageUrl?: string; videoUrl?: string; poster?: string }> {
  const q = media.query;

  if (media.type === "entity") {
    const e = await resolveEntityImage(q);
    if (e.imageUrl) return { imageUrl: e.imageUrl };
  }

  if (media.type === "photo" || media.type === "entity") {
    // Real, specific photograph of exactly what's described.
    if (hasSearch()) {
      const t = await imageSearch(q);
      if (t) return { imageUrl: t };
    }
    const c = await commonsImage(q);
    if (c) return { imageUrl: c };
    const w = await fetchWiki(q);
    if (w?.imageUrl) return { imageUrl: w.imageUrl };
    if (hasPexels()) {
      const p = (await pexelsPhotos(q, 1))[0];
      if (p) return { imageUrl: p };
    }
    return {};
  }

  // type === "clip": generic atmosphere → stock video, with image fallbacks.
  if (hasPexels()) {
    const v = (await pexelsVideos(q, 1))[0];
    if (v) return { videoUrl: v.url, poster: v.poster };
    const p = (await pexelsPhotos(q, 1))[0];
    if (p) return { imageUrl: p };
  }
  if (hasSearch()) {
    const t = await imageSearch(q);
    if (t) return { imageUrl: t };
  }
  const c = await commonsImage(q);
  if (c) return { imageUrl: c };
  return {};
}

const explainerGenSchema = z.object({
  title: z.string().describe("A short title for the explanation."),
  beats: z
    .array(
      z.object({
        say: z.string().describe("One spoken segment — one to three natural, substantive sentences."),
        media: z
          .object({
            query: z
              .string()
              .describe(
                "The PRECISE thing to show for this beat — match the exact objects/action/people you are describing right now, not a vague theme. E.g. you say he loaded a stone into his sling → 'leather sling and a smooth stone'; you say Trump met Putin in Alaska → 'Donald Trump and Vladimir Putin meeting Alaska summit'."
              ),
            label: z.string().describe("A short 2-4 word caption."),
            type: z
              .enum(["entity", "photo", "clip"])
              .describe(
                "entity = ONE specific named real thing (person, company, country, landmark) → its official image/logo/flag (query = the proper name). photo = a SPECIFIC real scene, event, group of people, or object that must be shown as a REAL PHOTOGRAPH of exactly that (e.g. two named leaders meeting, a sling and stone, a specific battle) → real photo search. clip = ONLY a generic action/atmosphere where stock video fits and no specific real footage is needed (e.g. 'stormy sea', 'crowd cheering', 'fire burning') → stock video. Prefer 'entity' or 'photo' for anything specific; use 'clip' sparingly."
              ),
          })
          .optional()
          .describe("Include for EVERY beat — the visuals must track exactly what you're saying."),
      })
    )
    .min(5)
    .max(10),
});

async function buildExplainer(query: string, question: string, ctx: BrainContext): Promise<Scene> {
  // Gather rich verified evidence: live search (current) + Wikipedia (depth + image).
  const [search, wiki] = await Promise.all([
    hasSearch() ? webSearch(question) : Promise.resolve(null),
    fetchWiki(query || question),
  ]);
  let facts = "";
  if (search && (search.answer || search.results.length))
    facts +=
      (search.answer ? `Latest summary: ${search.answer}\n` : "") +
      search.results.slice(0, 6).map((r) => `- ${trim(r.content, 500)}`).join("\n");
  if (wiki) facts += `\n${wiki.title}: ${wiki.extract}`;
  if (!facts.trim()) return chatReply(question, ctx, []);

  let object: z.infer<typeof explainerGenSchema>;
  try {
    ({ object } = await generateObject({
      model: hasAnthropic() ? MODELS.smart() : MODELS.fast(),
      schema: explainerGenSchema,
      system: `${ISAAC_PERSONA}${dateLine(
        ctx
      )}\nBuild a thorough, engaging spoken explainer that fully answers the user, using the verified facts below where they apply (for well-known stories/topics you may also use common knowledge, but never invent specifics). Make it genuinely informative — typically 6-9 beats — covering the essentials AND, where relevant, history, key facts, notable figures, and the LATEST developments. Build naturally so the user truly understands and feels satisfied; don't leave out important details.

For EACH beat, give one to three natural spoken sentences AND a "media" visual that depicts EXACTLY what you are saying in that beat — the specific objects, action, or people, not a vague theme. Include media on EVERY beat. Examples: you say "he loaded a stone into his sling" → query "leather sling and a smooth stone", type "photo". You say Trump and Putin met in Alaska → query "Donald Trump and Vladimir Putin meeting Alaska summit", type "photo". You introduce one named thing → type "entity" with its proper name. Only use type "clip" for purely generic atmosphere where no specific real footage is needed. Add a short label.
Plan the visuals to fit the timeline: for a history of a person/place/country, move the media from the OLDEST relevant imagery to the LATEST as the story progresses. Make each beat's media DIFFERENT (no repetition) unless the same visual genuinely fits best.
End the FINAL beat by warmly inviting the user to ask about anything specific they'd like to go deeper on.

State only established facts — never predictions, rumours, or opinions as fact. Never say you can't show or discuss something that's public and legal.\nVerified facts:\n${facts}`,
      prompt: question,
      temperature: 0.45,
      maxRetries: 1,
    }));
  } catch {
    // Fall back to a single grounded card if the structured build fails.
    return {
      say: await groundedSay(question, facts, ctx),
      expectsInput: "voice",
      experience: {
        type: "rich_card",
        title: wiki?.title || titleCase(query || question),
        body: await groundedSay(question, facts, ctx),
        imageUrl: wiki?.imageUrl,
      },
    };
  }

  // Resolve each beat's media in parallel — a real video or image from the best
  // available source. Only attach an entity if media actually resolved (so the
  // UI never shows a placeholder / initials).
  const topicFallback = wiki?.imageUrl; // last-resort image so no beat is blank
  const beats = await Promise.all(
    object.beats.map(async (b) => {
      if (!b.media) return { say: b.say };
      const m = await resolveBeatMedia(b.media);
      const imageUrl = m.videoUrl ? undefined : m.imageUrl ?? topicFallback;
      if (!imageUrl && !m.videoUrl) return { say: b.say };
      return {
        say: b.say,
        entity: {
          name: b.media.label,
          caption: b.media.label,
          imageUrl,
          videoUrl: m.videoUrl,
          poster: m.poster,
        },
      };
    })
  );

  return {
    say: object.title,
    expectsInput: "voice",
    experience: { type: "explainer", title: object.title, beats },
  };
}

// ── Math executor (Claude for accuracy; teaches in `say`) ──────────────

const mathSchema = z.object({
  say: z.string().describe("Isaac teaching the solution OUT LOUD — conversational, complete. Not just an intro."),
  title: z.string().optional(),
  steps: z
    .array(z.object({ latex: z.string().optional(), text: z.string() }))
    .min(1)
    .describe("Only as many steps as the problem genuinely needs — one is fine."),
  finalAnswer: z.string().optional(),
});

async function solveMath(problem: string, ctx: BrainContext): Promise<Scene> {
  const model = hasAnthropic() ? MODELS.smart() : MODELS.fast();
  try {
    const { object } = await generateObject({
      model,
      schema: mathSchema,
      system: `${ISAAC_PERSONA}${dateLine(
        ctx
      )}\nSolve this correctly and teach it. "say" is you explaining it aloud, clearly. "steps" is the visual breakdown — only as many as truly needed.`,
      prompt: problem,
      temperature: 0.3,
    });
    return {
      say: object.say,
      expectsInput: "voice",
      experience: {
        type: "math_steps",
        title: object.title,
        steps: object.steps,
        finalAnswer: object.finalAnswer,
      },
    };
  } catch {
    return { say: "Let me try that again — can you restate the problem?", expectsInput: "voice" };
  }
}

// ── Chat / greeting ────────────────────────────────────────────────────

async function chatReply(text: string, ctx: BrainContext, history: Turn[]): Promise<Scene> {
  const say = await isaacLine(
    ISAAC_PERSONA + dateLine(ctx) + contextPreamble(ctx),
    toMessages(history, text),
    "I'm here — what would you like to explore?"
  );
  return { say, expectsInput: "voice" };
}

function needsKeysScene(): Scene {
  return {
    say: "I'm Isaac. I'm almost ready — I just need my voice and brain connected.",
    expectsInput: "none",
  };
}

// ── Context-aware planner (used when something is already on the Stage) ──
// Decides switch vs follow-up vs reaction vs confirmation so Isaac never gets
// confused or blends topics. Isaac only *speaks content* after a full rebuild.

type Plan = {
  intent: "explain" | "ask_switch" | "continue" | "react" | "chat" | "math" | "flags" | "signup" | "login";
  topic?: string;
  say?: string;
};

function currentTopicLabel(req: BrainRequest): string {
  const e = req.experience;
  if (e?.type === "explainer" || e?.type === "rich_card") return String(e.title ?? "the current topic");
  if (e?.type === "math_steps") return "a math solution";
  if (e?.type === "flag_quiz") return "a flag game";
  return "the current topic";
}

function parsePlan(text: string): Plan | null {
  try {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a === -1 || b === -1) return null;
    const obj = JSON.parse(text.slice(a, b + 1));
    return typeof obj.intent === "string" ? (obj as Plan) : null;
  } catch {
    return null;
  }
}

async function planWithContext(req: BrainRequest, ctx: BrainContext): Promise<Plan | null> {
  const topic = currentTopicLabel(req);
  const system = `${ISAAC_PERSONA}${dateLine(
    ctx
  )}\nThere is content on the Stage right now about: "${topic}". Decide how to handle the user's latest message so you are NEVER confused and never blend topics. Respond with ONLY a single-line JSON object:
{"intent":"explain|ask_switch|continue|react|chat|math|flags|signup|login","topic":"...","say":"..."}
Rules:
- A clear request for a DIFFERENT complete topic, OR a follow-up clearly RELATED to "${topic}" → "explain" with "topic" set (we rebuild fresh — no blending).
- Just a short bare new subject unrelated to "${topic}" (e.g. only "North Korea") → "ask_switch"; write "say" as a brief question confirming they want to move to it (e.g. "Want me to switch over to North Korea?"). Leave "topic" empty.
- If you just asked whether to switch and they AGREE (yes/sure/go ahead) → "explain" with "topic" = the subject you offered. If they DECLINE (no/not now) → "continue" with a brief "okay, staying here" in "say".
- A reaction or comment (e.g. "I love this", "thanks", or they dislike it) → "react"; "say" = a VERY brief warm acknowledgement (one short sentence). If they're unhappy, ask what they'd like instead.
- "continue" / "carry on" / "keep going" / "where were you" → "continue" with "say" = a 2-4 word lead-in like "Sure, picking it up.". The explainer resumes automatically afterwards — do NOT re-explain anything.
- A math problem → "math" ("topic"=the problem). A flag game request → "flags". Account actions → "signup"/"login".
- Otherwise smalltalk → "chat" with a short "say".
IMPORTANT: ask_switch / continue / react / chat replies must be SHORT acknowledgements only — NEVER give facts, opinions, or explanations in them. Anything informational MUST be "explain" so it gets a card and media.`;
  try {
    const { text } = await generateText({
      model: MODELS.fast(),
      system,
      messages: toMessages(req.history, req.text),
      temperature: 0.3,
      maxTokens: 300,
      maxRetries: 1,
    });
    return parsePlan(text);
  } catch {
    return null;
  }
}

// ── Entry point ────────────────────────────────────────────────────────

export async function orchestrate(req: BrainRequest, ctx: BrainContext): Promise<Scene> {
  if (!hasGroq()) return needsKeysScene();

  if (req.kind === "greeting") {
    const authed = ctx.user?.isAuthed;
    const content = authed
      ? `Greet ${ctx.user?.name || "them"} back warmly by name in ONE short, fresh sentence, and invite them to explore anything.`
      : "This is the very first thing you say. Introduce yourself as Isaac in one or two warm, fresh sentences, and warmly invite the person to create a free account so you can remember them and make it personal. Be specific and inviting, not generic.";
    const say = await isaacLine(
      ISAAC_PERSONA + dateLine(ctx) + contextPreamble(ctx),
      [{ role: "user", content }],
      authed
        ? `Welcome back${ctx.user?.name ? `, ${ctx.user.name}` : ""}! What shall we dive into?`
        : "Hi, I'm Isaac — your guide to just about anything. Want to make a quick free account so I can remember you?"
    );
    return { say, expectsInput: "voice" };
  }

  // Flag guess/next are handled locally on the client now; keep safe fallbacks.
  if (req.kind === "flag_next" || req.kind === "flag_guess") {
    const f = activeFlag(req);
    const correct =
      req.kind === "flag_guess" && f
        ? isCorrectGuess(req.text ?? "", { name: f.answer, aliases: f.aliases } as Country)
        : false;
    const next = pickCountry(f?.code);
    return buildFlagScene(
      next,
      (f?.round ?? 1) + 1,
      (f?.score ?? 0) + (correct ? 1 : 0),
      req.kind === "flag_guess"
        ? correct
          ? `That's ${f?.answer} — nice! Here's another.`
          : `That was ${f?.answer}. Try this one.`
        : "Here's another."
    );
  }

  // utterance
  const q = req.text ?? "";
  // Date/time questions → built directly from the real client clock: accurate,
  // deterministic, no model guessing, no card divergence.
  if (DATE_Q.test(q.trim())) {
    const now = ctx.now ? new Date(ctx.now) : new Date();
    let when = now.toISOString();
    try {
      when = now.toLocaleString(ctx.locale || "en-US", {
        timeZone: ctx.timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      /* keep ISO */
    }
    return { say: `It's ${when}.`, expectsInput: "voice" };
  }

  // Identity questions → from the account (pops the profile open), or invite signup.
  if (IDENTITY_Q.test(q)) {
    if (ctx.user?.isAuthed) {
      let created = "";
      if (ctx.user.createdAt) {
        try {
          created = new Date(ctx.user.createdAt).toLocaleDateString(ctx.locale || "en-US", {
            timeZone: ctx.timezone,
            year: "numeric",
            month: "long",
            day: "numeric",
          });
        } catch {
          /* ignore */
        }
      }
      const name = ctx.user.name;
      const say = name
        ? `You're ${name}${created ? `, and you joined Clunoid on ${created}` : ""}. There you are — that's you.`
        : `You're signed in${created ? `, and you joined on ${created}` : ""}.`;
      return { say, showProfile: true, keep: true, resume: true, expectsInput: "voice" };
    }
    return {
      say: "We haven't properly met yet! Let's create your account so I can remember you and make this personal.",
      auth: "signup",
      expectsInput: "none",
    };
  }

  // If content is already on the Stage, plan with context so Isaac never gets
  // confused (switch vs follow-up vs reaction vs confirming a switch). Content
  // is only ever spoken after a full rebuild; short replies keep the screen.
  const onScreen = req.experience?.type;
  if (onScreen === "explainer" || onScreen === "rich_card" || onScreen === "math_steps") {
    const plan = await planWithContext(req, ctx);
    if (plan) {
      switch (plan.intent) {
        case "explain":
          return buildExplainer(plan.topic || q, plan.topic || q, ctx);
        case "math":
          return solveMath(plan.topic || q, ctx);
        case "flags": {
          const c = pickCountry();
          return buildFlagScene(c, 1, 0, "Let's play! Which country does this flag belong to?");
        }
        case "signup":
          return { say: plan.say || "Let's set up your account.", auth: "signup", expectsInput: "none" };
        case "login":
          return { say: plan.say || "Welcome back.", auth: "login", expectsInput: "none" };
        case "ask_switch":
          // Ask, keep content, and WAIT for the answer (no resume).
          return { say: plan.say || "Want me to switch to that?", keep: true, expectsInput: "voice" };
        // continue / react / chat → brief reply, KEEP content, then RESUME where Isaac left off.
        default:
          return {
            say: plan.say || "Got it.",
            keep: true,
            resume: true,
            expectsInput: "voice",
          };
      }
    }
    // planner failed → fall through to the default routing below.
  }

  // "Who currently leads X?" → quick authoritative card (Wikidata). Fast, single fact.
  if (OFFICEHOLDER.test(q) && CURRENTISH.test(q)) return factScene(extractTopic(q), q, ctx);

  // Any other topic / current-event question → a synced visual EXPLAINER
  // (images appear as Isaac narrates). This is the default for "anything about X".
  if (looksFactual(q) || looksCurrent(q)) return buildExplainer(extractTopic(q), q, ctx);

  // otherwise let the router decide (flags / math / auth / talk)
  const d = await decide(req, ctx);
  if (!d) return chatReply(req.text ?? "", ctx, req.history ?? []); // graceful, never "say that again"

  switch (d.action) {
    case "fact":
      return buildExplainer(d.query || req.text || "", req.text || d.query || "", ctx);
    case "start_flags": {
      // Only ever start a game when the user actually asked — never force it.
      if (!/\b(flag|flags|guess.*countr|play.*(game|flag)|quiz)\b/i.test(q)) {
        return {
          say: "Sure — whenever you'd like, just say 'let's play flags' and I'll start a round. What would you like to do?",
          expectsInput: "voice",
        };
      }
      // Isaac can't see which flag the code picked, so use a neutral intro
      // (no invented hints about the flag).
      const c = pickCountry();
      const intros = [
        "Let's play! Which country does this flag belong to?",
        "Here we go — name this flag for me.",
        "Alright, first flag. Which country is this?",
        "Game on! What country flies this flag?",
      ];
      return buildFlagScene(c, 1, 0, intros[Math.floor(Math.random() * intros.length)]);
    }
    case "math":
      return solveMath(d.query || req.text || "", ctx);
    case "signup":
      return { say: d.say, auth: "signup", expectsInput: "none" };
    case "login":
      return { say: d.say, auth: "login", expectsInput: "none" };
    case "stop":
      return { say: d.say, clear: true, expectsInput: "voice" };
    default:
      return { say: d.say, clear: d.clear, expectsInput: "voice" };
  }
}
