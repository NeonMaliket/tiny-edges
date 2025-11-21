import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEnv } from "./env.ts";

export const supabaseAdmin = createClient(
   getEnv("SUPABASE_URL"),
   getEnv("SUPABASE_SERVICE_ROLE_KEY"),
);
