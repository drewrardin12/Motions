const SUPABASE_URL = "https://vcqlmcamyblclgyvcaxu.supabase.co";
const SUPABASE_KEY = "sb_publishable_Sufhk8IG82ilf09IKN08eQ_o4oE5mv1";
const AUTH_KEY = "motions-supabase-auth";

type Session = { access_token: string; refresh_token: string; expires_at?: number };

function savedSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}

async function anonymousSession(): Promise<Session> {
  const saved = savedSession();
  if (saved?.access_token) return saved;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error("Anonymous sign-in is not enabled yet.");
  const data = await res.json();
  const session = data.session as Session;
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

export async function rpc<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const session = await anonymousSession();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || data?.error || "The household service could not be reached.");
  return data as T;
}

export type HouseholdMember = { id: string; name: string; is_admin: boolean };
export type HouseholdState = { household_id: string; household_name: string; members: HouseholdMember[] };

export const householdApi = {
  mine: () => rpc<HouseholdState | null>("get_my_household"),
  create: (andrewPin: string, abbyPin: string) => rpc<{ household: HouseholdState; join_code: string }>("create_motions_household", { p_andrew_pin: andrewPin, p_abby_pin: abbyPin }),
  join: (code: string) => rpc<HouseholdState>("join_motions_household", { p_join_code: code.toUpperCase().replace(/\s/g, "") }),
  verify: (memberId: string, pin: string) => rpc<boolean>("verify_member_pin", { p_member_id: memberId, p_pin: pin }),
};
