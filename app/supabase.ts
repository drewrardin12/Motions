const SUPABASE_URL = "https://vcqlmcamyblclgyvcaxu.supabase.co";
const SUPABASE_KEY = "sb_publishable_Sufhk8IG82ilf09IKN08eQ_o4oE5mv1";
const AUTH_KEY = "motions-supabase-auth";

type Session = { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number };
let signingIn: Promise<Session> | null = null;
export class HouseholdConnectionError extends Error {}
export class HouseholdSessionExpiredError extends Error { constructor(){super("This phone’s household session expired. Reconnect this device with your setup code.");} }

async function request(url: string, options: RequestInit) {
  return fetch(url, {...options, signal: AbortSignal.timeout(15000)});
}

function savedSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}

function storeSession(data: unknown): Session {
  const response = data as { session?: Session; access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number } | null;
  const session = response?.session ?? response;
  if (!session?.access_token || !session.refresh_token) {
    throw new Error("Supabase did not return a valid sign-in session.");
  }
  session.expires_at ??= Math.floor(Date.now()/1000)+(session.expires_in ?? 3600);
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session as Session;
}

async function refreshSession(saved: Session): Promise<Session | null> {
  if (!saved.refresh_token) return null;
  const res = await request(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: saved.refresh_token }),
  });
  if (res.status >= 500 || res.status === 429) throw new HouseholdConnectionError("The household service is temporarily unavailable. Your saved session is unchanged.");
  if (!res.ok) return null;
  return storeSession(await res.json());
}

async function obtainSession(): Promise<Session> {
  const saved = savedSession();
  const now = Math.floor(Date.now() / 1000);
  if (saved?.access_token && (!saved.expires_at || saved.expires_at > now + 60)) return saved;
  if (saved) {
    const refreshed = await refreshSession(saved);
    if (refreshed) return refreshed;
    throw new HouseholdSessionExpiredError();
  }
  const res = await request(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error("Anonymous sign-in is not enabled yet.");
  return storeSession(await res.json());
}

async function anonymousSession(): Promise<Session> {
  if (!signingIn) signingIn = obtainSession().finally(() => { signingIn = null; });
  return signingIn;
}

export function reconnectDevice() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem("motions-identity");
}

export async function rpc<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const session = await anonymousSession();
  const options = {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  let res = await request(`${SUPABASE_URL}/rest/v1/rpc/${name}`, options);
  if (res.status === 401) {
    const saved=savedSession();
    if(saved?.access_token===session.access_token){saved.expires_at=0;localStorage.setItem(AUTH_KEY,JSON.stringify(saved));}
    const renewed=await anonymousSession();
    res=await request(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {...options,headers:{...options.headers,Authorization:`Bearer ${renewed.access_token}`}});
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if(res.status===401) throw new HouseholdSessionExpiredError();
    const message=data?.message || data?.error || "The household service could not be reached.";
    if(res.status >= 500 || res.status === 429) throw new HouseholdConnectionError(message);
    throw new Error(message);
  }
  return data as T;
}

export type HouseholdMember = { id: string; name: string; is_admin: boolean };
export type HouseholdState = { household_id: string; household_name: string; members: HouseholdMember[]; remembered_member_id?: string | null };
export type ProgressRow = { period_key: string; item_type: string; item_id: string; completed: boolean; updated_by_name: string | null; updated_at: string };
export type SharedMotion = { id: string; title: string; label: string; time: string; image: string; accent: string; message: string; tasks: string[]; taskIds?: string[] };
export type RhythmRecurrence = "daily" | "weekly" | "monthly" | "custom";
export type SharedRhythm = {
  id: string;
  title: string;
  category: string;
  assignee: "Everyone" | "Andrew" | "Abby";
  recurrence: RhythmRecurrence;
  days: number[];
  dayOfMonth: number;
  intervalDays: number;
  startDate: string;
};

export const householdApi = {
  mine: () => rpc<HouseholdState | null>("get_my_household"),
  create: (andrewPin: string, abbyPin: string) => rpc<{ household: HouseholdState; join_code: string }>("create_motions_household", { p_andrew_pin: andrewPin, p_abby_pin: abbyPin }),
  join: async (code: string) => {
    const body={p_join_code:code.toUpperCase().replace(/\s/g, "")};
    try{return await rpc<HouseholdState>("join_motions_household",body);}
    catch(error){if(!(error instanceof HouseholdSessionExpiredError))throw error;reconnectDevice();return rpc<HouseholdState>("join_motions_household",body);}
  },
  verify: (memberId: string, pin: string) => rpc<boolean>("verify_member_pin", { p_member_id: memberId, p_pin: pin }),
  remember: (memberId: string, pin: string) => rpc<boolean>("remember_member", { p_member_id: memberId, p_pin: pin }),
  progress: (periodKeys: string[]) => rpc<ProgressRow[]>("get_household_progress", { p_period_keys: periodKeys }),
  setProgress: (memberId: string, periodKey: string, itemType: string, itemId: string, completed: boolean) => rpc<boolean>("set_household_progress", {
    p_member_id: memberId,
    p_period_key: periodKey,
    p_item_type: itemType,
    p_item_id: itemId,
    p_completed: completed,
  }),
  motions: () => rpc<SharedMotion[]>("get_household_motions"),
  saveMotions: (memberId: string, motions: SharedMotion[], expected: SharedMotion[] = []) => rpc<boolean>("save_household_motions_checked", {
    p_member_id: memberId,
    p_motions: motions,
    p_expected: expected,
  }),
  rhythms: () => rpc<SharedRhythm[]>("get_household_rhythms"),
  saveRhythms: (memberId: string, rhythms: SharedRhythm[], expected: SharedRhythm[] = []) => rpc<boolean>("save_household_rhythms_checked", {
    p_member_id: memberId,
    p_rhythms: rhythms,
    p_expected: expected,
  }),
};
