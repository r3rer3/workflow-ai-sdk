import { NextResponse } from "next/server";
import {
  getSupabaseServerClient,
  readSupabaseExampleEnv,
} from "../../../lib/supabase-server";

// Pedagogical sign-in helper for the /api/db example.
//
// Accepts `POST { email, password }`, calls signInWithPassword via the
// @supabase/ssr server client so the session is written into cookies, and
// returns a tiny JSON body. Using this from curl:
//
//   curl -c cookies.txt -X POST http://localhost:3000/api/auth \
//     -H 'content-type: application/json' \
//     -d '{"email":"demo@example.com","password":"..."}'
//
// ...and then reuse cookies.txt with `curl -b cookies.txt` against /api/db.
//
// THIS IS NOT A PRODUCTION AUTH FLOW. There's no rate limiting, no password
// reset, no MFA, no email verification. It exists so readers can exercise
// the Supabase example with curl alone. Real apps should replace this with
// their own sign-in implementation and delete this file.

interface AuthRequestBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  const env = readSupabaseExampleEnv();

  if (!env) {
    return NextResponse.json(
      {
        error: "Supabase example is not configured.",
        hint: "Copy apps/examples/.env.local.example to apps/examples/.env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      },
      { status: 503 },
    );
  }

  const body: AuthRequestBody = await request.json();

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      {
        error: "Missing email or password.",
      },
      { status: 400 },
    );
  }

  const supabase = await getSupabaseServerClient(env);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      {
        error: "Invalid credentials.",
      },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      user: {
        id: data.user.id,
      },
    },
    { status: 200 },
  );
}
