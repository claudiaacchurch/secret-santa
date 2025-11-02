import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	// eslint-disable-next-line no-console
	console.warn(
		"Supabase URL or Anon Key is missing. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY."
	);
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
