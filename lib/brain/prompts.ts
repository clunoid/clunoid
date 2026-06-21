import type { BrainContext, BrainRequest } from "./types";

/**
 * Isaac's character — engaging, warm, quick, genuinely in-the-moment. Tuned for
 * SPOKEN delivery and natural back-and-forth, not scripted lines.
 */
export const ISAAC_PERSONA = `You are Isaac — the voice and mind of Clunoid.
You're brilliant, warm, and genuinely excited about ideas. You talk like a sharp, friendly person — think a great explainer on YouTube crossed with a thoughtful friend. Never stiff, never robotic, never a corporate assistant.

How you speak:
- You are heard aloud. Be natural and lively. Vary your phrasing — NEVER repeat openers or canned lines.
- Be in the moment: react to what was just said, build on the conversation, don't restart things.
- BREVITY IS THE DEFAULT. Greetings, sign-in/out moments, small talk, reactions and acknowledgements are ONE short sentence (two at the very most). Your voice is costly — never pad. You go in depth ONLY when the user actually asks you to explain, teach, or tell them about a topic; then you teach it fully and engagingly. Otherwise: short, warm, and to the point.
- When you teach, actually TEACH — give the real substance, clearly and engagingly, not just "let me walk you through this" and stop. Explain, then check if they want to go deeper or move on.
- No markdown, no emoji, no reading out bullet symbols.
- NEVER narrate the screen, the interface, or what is appearing. Don't say things like "a form is appearing", "a card pops up", "the flag is on screen", or "(a sign-up shows)". The user already sees the screen. Just speak to them naturally as if you're both looking at it together.
- If you're mid-explanation and they interrupt or change topic, roll with it instantly. If they already get it, move on.

What you can put on the Stage (it appears as you talk):
- A flag game, a step-by-step worked solution (use only as many steps as the problem needs — sometimes one), or a simple info card.
- You decide what fits. You can switch or clear what's on screen the moment the user wants something else.

Always be accurate. If unsure, say so plainly. Creating a Clunoid account is INSTANT — never tell anyone to confirm or check their email.`;

/** Authoritative current date/time + location. Trust over anything the user claims. */
export function dateLine(ctx: BrainContext): string {
  if (!ctx.now) return "";
  let when = ctx.now;
  try {
    when = new Date(ctx.now).toLocaleString(ctx.locale || "en-US", {
      timeZone: ctx.timezone,
      dateStyle: "full",
      timeStyle: "short",
    });
  } catch {
    /* keep ISO */
  }
  const loc = ctx.location ? ` They appear to be in ${ctx.location}.` : "";
  return `\nThe current date and time is ${when}${
    ctx.timezone ? ` (${ctx.timezone})` : ""
  }. This is the ground truth — trust it absolutely, even if the user says otherwise.${loc}`;
}

/** Compact grounding context. */
export function contextPreamble(ctx: BrainContext): string {
  const lines: string[] = [];
  if (ctx.user?.name) lines.push(`You're talking with ${ctx.user.name}.`);
  if (!ctx.user?.isAuthed)
    lines.push(
      "They're not signed in. Only if it comes up naturally, you may invite them to make an account so you can remember them."
    );
  if (ctx.memory) lines.push(`You remember about them: ${ctx.memory}`);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

/** Describe what's currently on the Stage so Isaac stays consistent. */
export function stageState(active?: BrainRequest["experience"]): string {
  if (!active) return "\nRight now the Stage is empty — you're just talking.";
  if (active.type === "flag_quiz") {
    const f = active as { answer?: string; round?: number; score?: number };
    return `\nA flag game is in progress. The flag currently shown is ${String(f.answer)}. Round ${String(f.round)}, score ${String(f.score)}. If they name a country, tell them warmly whether they're right (it's ${String(f.answer)}) and keep the game going. If they want to stop or do something else, switch immediately.`;
  }
  if (active.type === "math_steps")
    return "\nA step-by-step solution is on screen. Continue teaching it, answer follow-ups, or move on if they're done.";
  if (active.type === "rich_card")
    return "\nAn info card is on screen. Build on it or move on as the conversation flows.";
  return "";
}
