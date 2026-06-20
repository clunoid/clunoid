import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * OAuth (Google) redirect target. Exchanges the auth code for a session
 * (sets the cookies), then returns the user to the app.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  if (code) {
    try {
      const supabase = await getSupabaseServer();
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      /* fall through to redirect home */
    }
  }
  return NextResponse.redirect(origin);
}
