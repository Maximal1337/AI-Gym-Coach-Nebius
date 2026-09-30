import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** The whole error body, for the fields next to `error` (e.g. assistant-send's `reason`). */
    public body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Call an Edge Function with the signed-in user's JWT. */
export async function callFn<T = Record<string, unknown>>(
  name: string,
  body: unknown,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'not_signed_in');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, (json.error as string) ?? 'unknown', json);
  return json as T;
}
