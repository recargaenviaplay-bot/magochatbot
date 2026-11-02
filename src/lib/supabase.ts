import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_BOTMG_SUPABASE_URL as string;
const key = import.meta.env.VITE_BOTMG_SUPABASE_ANON_KEY as string;
if (!url || !key) throw new Error("Configure VITE_BOTMG_SUPABASE_URL e VITE_BOTMG_SUPABASE_ANON_KEY no ambiente do BOTMG.");
export const botmgSupabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
