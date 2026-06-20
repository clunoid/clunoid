import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/brain/orchestrate";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { BrainRequest, BrainContext } from "@/lib/brain/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: BrainRequest;
  try {
    body = (await req.json()) as BrainRequest;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const ctx: BrainContext = {
    user: body.user ?? { isAuthed: false },
    // Accurate time/locale from the browser (so Isaac never gets the date wrong).
    now: body.client?.now ?? new Date().toISOString(),
    timezone: body.client?.timezone,
    locale: body.client?.locale,
  };

  // Coarse location hint for personalization (best-effort, no extra latency).
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd && !fwd.startsWith("127.") && fwd !== "::1") ctx.location = body.client?.timezone;

  // Enrich context from Supabase when the user is signed in (RLS-scoped).
  try {
    const supabase = await getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      ctx.user = {
        name: (user.user_metadata?.name as string) || body.user?.name,
        isAuthed: true,
      };
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, about")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        ctx.user.name = profile.display_name || ctx.user.name;
        if (typeof profile.about === "string") ctx.memory = profile.about;
      }
    }
  } catch {
    // Not signed in, or DB not provisioned yet — continue with minimal context.
  }

  // Lightweight rolling summary from the recent turns the client sent.
  if (body.history?.length) {
    ctx.summary = body.history
      .slice(-6)
      .map((t) => `${t.role === "isaac" ? "Isaac" : "User"}: ${t.content}`)
      .join(" | ");
  }

  try {
    const scene = await orchestrate(body, ctx);
    return NextResponse.json(scene);
  } catch (err) {
    console.error("brain error:", err);
    return NextResponse.json({
      say: "Sorry — my thoughts tangled for a second there. Could you say that again?",
      expectsInput: "voice",
    });
  }
}
