import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jvybnamzibyvjftoknzz.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_x-yWWJsyWtwIF0439FcxGw_sSV5wtAO";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
