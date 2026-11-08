import { humanError, AholoClient } from "./aholo";
import { InputError } from "./validate";

/** Small helpers shared by the API routes. */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof InputError) return json({ error: e.message }, e.status);
  console.error("[api]", humanError(e));
  return json({ error: "Something went wrong on our side. Please try again." }, 500);
}

let credits: { at: number; value: number | null } | null = null;

/** The Lux3D balance, cached for 5 minutes per instance (null when it can't be read). */
export async function cachedCredits(force = false): Promise<number | null> {
  if (!force && credits && Date.now() - credits.at < 5 * 60_000) return credits.value;
  try {
    const { credits: c } = await new AholoClient().balance();
    credits = { at: Date.now(), value: c };
  } catch {
    credits = { at: Date.now() - 4 * 60_000, value: credits?.value ?? null }; // retry in a minute
  }
  return credits.value;
}
