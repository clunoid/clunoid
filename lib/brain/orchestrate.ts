import { generateObject, generateText, type CoreMessage } from "ai";
import { z } from "zod";
import { MODELS, hasGroq, hasAnthropic } from "@/lib/models";
import { ISAAC_PERSONA, contextPreamble, dateLine } from "./prompts";
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

// Newsy / current-event detection → boost the search query for freshness.
function isNewsy(text: string): boolean {
  return (
    /\b(news|headlines?|breaking|current events|what'?s happening|what is happening|trending)\b/i.test(text) ||
    CURRENTISH_Q.test(text)
  );
}

// A pure greeting / acknowledgement (no real subject to research) → brief reply.
function isSmallTalk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.split(/\s+/).length > 5) return false; // anything longer is a real request
  return /^(hi+|hey+|hello+|yo|hiya|howdy|sup|wass?up|what'?s up|whats up|greetings|thanks?|thank you|thanx|thx|ty|cheers|cool|nice|wow|ok(ay)?|kk|great|awesome|amazing|perfect|lovely|haha+|lol|lmao|good (job|one|stuff|morning|afternoon|evening|night)|well done|nice one|bye+|goodbye|see ya|see you|later|how are you|how'?s it going|how are things|you (there|good|ok))[!.\s?]*$/i.test(
    t
  );
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
    .min(3)
    .max(14),
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
      )}\nBuild a thorough, engaging spoken explainer that fully answers the user, using the verified facts below where they apply (for well-known stories/topics you may also use common knowledge, but never invent specifics). Scale the LENGTH to the request: use only a few beats (3-5) for a simple or narrow question, and many (up to a dozen or more) for a rich subject — a full history, a deep "tell me everything", or a news roundup. Cover the essentials AND, where relevant, history, key facts, notable figures, and the LATEST developments. Never pad a simple ask, and never cut important detail from a big one. Build naturally so the user truly understands and feels satisfied.

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

// ── Date / time — the real client clock, plus what's notable about today ──────
// "What time is it" stays terse. "What's the date / what day is it" also tells
// them what today is about (a holiday or famous event) with a matching picture.
async function dateScene(q: string, ctx: BrainContext): Promise<Scene> {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const fmt = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return now.toLocaleString(ctx.locale || "en-US", { timeZone: ctx.timezone, ...opts });
    } catch {
      return now.toISOString();
    }
  };
  // A pure "what time is it" stays terse and instant.
  if (/\btime\b/i.test(q) && !/\b(date|day)\b/i.test(q)) {
    return { say: `It's ${fmt({ hour: "numeric", minute: "2-digit" })}.`, expectsInput: "voice" };
  }
  const full = fmt({ weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const monthDay = fmt({ month: "long", day: "numeric" });
  // What's notable about today (holiday / famous events) + a real picture.
  try {
    if (hasSearch()) {
      const search = await webSearch(`${monthDay}: holidays, observances and notable historical events`);
      const facts =
        search?.answer ||
        (search?.results?.length ? search.results.slice(0, 3).map((r) => trim(r.content, 320)).join("\n") : "");
      if (facts) {
        const say = await groundedSay(
          `Today is ${full}. In 1-2 warm sentences, tell them today's date and the single most notable thing about ${monthDay} — a holiday or a famous event. Keep it short.`,
          facts,
          ctx
        );
        const media = await resolveBeatMedia({ query: `${monthDay} holiday celebration`, type: "photo" });
        return {
          say,
          expectsInput: "voice",
          experience: { type: "rich_card", title: full, body: say, imageUrl: media.imageUrl },
        };
      }
    }
  } catch {
    /* fall back to the plain date below */
  }
  return { say: `It's ${full}.`, expectsInput: "voice" };
}

// ── Context-aware planner (used when something is already on the Stage) ──
// Decides switch vs follow-up vs reaction vs confirmation so Isaac never gets
// confused or blends topics. Isaac only *speaks content* after a full rebuild.

type Plan = {
  intent: "explain" | "continue" | "react" | "chat" | "math" | "flags" | "signup" | "login";
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
  )}\nThere is content on the Stage right now about: "${topic}". Treat the user's latest message as a COMMAND to act on — NEVER ask whether they want to switch, just do it. Respond with ONLY a single-line JSON object:
{"intent":"explain|continue|react|chat|math|flags|signup|login","topic":"...","say":"..."}
Rules:
- ANY new subject — a full question OR even a single bare word that names a different thing (e.g. just "Trump", "Mars", "news") → "explain" with "topic" = that subject. Switch to it immediately; do NOT ask, do NOT confirm.
- A follow-up that goes DEEPER on "${topic}" → "explain" with "topic" = the specific follow-up (we rebuild fresh — no blending).
- "continue" / "carry on" / "keep going" / "where were you" → "continue" with "say" = a 2-4 word lead-in like "Sure, picking it up.". The explainer resumes automatically afterwards — do NOT re-explain anything.
- A pure reaction with no subject (e.g. "I love this", "thanks", "nice") → "react"; "say" = a VERY brief warm acknowledgement (one short sentence).
- A math problem → "math" ("topic"=the problem). A flag game request → "flags". Account actions → "signup"/"login".
- Only truly empty small talk with no subject and no reaction → "chat" with a short "say".
IMPORTANT: continue / react / chat replies must be SHORT acknowledgements only — NEVER give facts, opinions, or explanations in them. Anything with a subject MUST be "explain" so it gets a fresh card and media. When unsure, prefer "explain".`;
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

  // An account state just changed (sign up / sign in / sign out). The brain
  // decides — in real time — what Isaac says, so the spoken word always matches
  // what actually happened. Always ONE short, fresh sentence (never narrate UI).
  if (req.kind === "auth_event") {
    const name = ctx.user?.name || req.user?.name;
    const persona = ISAAC_PERSONA + dateLine(ctx);

    if (req.event === "signed_out") {
      const say = await isaacLine(
        persona,
        [
          {
            role: "user",
            content: `${
              name ? `${name} is` : "They are"
            } signing out right now. Say a warm, brief ONE-sentence goodbye that reassures them you'll pick up right where you left off whenever they come back. Do NOT invent, name, or reference any specific topic or subject — keep it general. No questions, no narration.`,
          },
        ],
        `Anytime${name ? `, ${name}` : ""} — come back whenever and we'll pick up right where we left off.`
      );
      return { say, clear: true, expectsInput: "none" };
    }

    if (req.event === "signed_up") {
      const say = await isaacLine(
        persona + contextPreamble(ctx),
        [
          {
            role: "user",
            content: `${
              name || "They"
            } just created their account. In ONE warm, fresh sentence, welcome them by name and let them know they can ask about anything — out loud or typed. Keep it short; don't describe the screen.`,
          },
        ],
        `You're all set${name ? `, ${name}` : ""}! Ask me anything — say it or type it — and I'll show you.`
      );
      return { say, expectsInput: "voice" };
    }

    // signed_in → welcome back; keep any content on screen and resume it after.
    const say = await isaacLine(
      persona + contextPreamble(ctx),
      [
        {
          role: "user",
          content: `${
            name || "They"
          } just signed back in. Welcome them back by name in ONE short, fresh sentence and invite them to continue or explore something new. Keep it short; don't describe the screen.`,
        },
      ],
      `Welcome back${name ? `, ${name}` : ""}! What shall we get into?`
    );
    return { say, keep: true, resume: true, expectsInput: "voice" };
  }

  if (req.kind === "greeting") {
    if (ctx.user?.isAuthed) {
      const say = await isaacLine(
        ISAAC_PERSONA + dateLine(ctx) + contextPreamble(ctx),
        [
          {
            role: "user",
            content: `Greet ${ctx.user?.name || "them"} back warmly by name in ONE short, fresh sentence, and invite them to explore anything.`,
          },
        ],
        `Welcome back${ctx.user?.name ? `, ${ctx.user.name}` : ""}! What shall we dive into?`
      );
      return { say, expectsInput: "voice" };
    }
    // New / signed-out → a brief, sweet intro that opens the sign-up form. The
    // form is opening on its own — invite them to fill it in, but NEVER narrate
    // the screen (no "a form appears"). One short, warm sentence.
    const say = await isaacLine(
      ISAAC_PERSONA + dateLine(ctx),
      [
        {
          role: "user",
          content:
            "Say hello and introduce yourself as Isaac in ONE short, warm sentence, and invite them to pop their name and email in to get started so you can remember them and make this theirs. Sign-up is INSTANT — never mention confirming email. Don't ask whether they want an account, and don't describe the screen — just warmly invite them in.",
        },
      ],
      "Hey, I'm Isaac — pop your name and email in and I'll remember you and make all of this yours."
    );
    return { say, auth: "signup", expectsInput: "none" };
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
  // Date/time questions → the real client clock (accurate, deterministic), plus
  // what today is about when they ask for the date.
  if (DATE_Q.test(q.trim())) return dateScene(q, ctx);

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

  // ── From here, Clunoid behaves like a search engine: ANY word, phrase, or
  // question becomes a thought-through, media-backed answer. We never ignore an
  // input, never ask "did you mean…", and never ramble — we research and show. ──

  // Explicit account actions.
  if (/\b(sign\s?up|create (an )?account|register|make (me )?an account)\b/i.test(q))
    return { say: "Let's set you up.", auth: "signup", expectsInput: "none" };
  if (/\b(sign\s?in|log\s?in)\b/i.test(q))
    return { say: "Let's get you back in.", auth: "login", expectsInput: "none" };

  // Clear the Stage.
  if (/^(stop|clear|reset|never\s?mind|that'?s all|nothing( else)?)\b/i.test(q.trim()))
    return { say: "Cleared — what would you like next?", clear: true, expectsInput: "voice" };

  // A calculation or worked problem → step-by-step solution.
  if (MATHISH.test(q)) return solveMath(q, ctx);

  // A flag game, only when actually requested.
  if (/\b(flags?|guess.*countr|play.*(game|flag)|quiz)\b/i.test(q)) {
    const c = pickCountry();
    const intros = [
      "Let's play! Which country does this flag belong to?",
      "Here we go — name this flag for me.",
      "Alright, first flag. Which country is this?",
      "Game on! What country flies this flag?",
    ];
    return buildFlagScene(c, 1, 0, intros[Math.floor(Math.random() * intros.length)]);
  }

  // "Who currently leads X?" → quick authoritative card (Wikidata). Fast, single fact.
  if (OFFICEHOLDER.test(q) && CURRENTISH.test(q)) return factScene(extractTopic(q), q, ctx);

  // Pure greeting / acknowledgement (no subject to research) → a brief, warm reply.
  if (isSmallTalk(q)) return chatReply(q, ctx, req.history ?? []);

  // DEFAULT — research the topic and build a synced visual explainer. News and
  // current events get a freshness-boosted query so the very latest is covered.
  const question = isNewsy(q)
    ? `Latest news and developments, most important first${ctx.location ? `, near ${ctx.location}` : ""}: ${q}`
    : q;
  return buildExplainer(extractTopic(q), question, ctx);
}
