export type EnvVar =
   | "SUPABASE_URL"
   | "SUPABASE_SERVICE_ROLE_KEY"
   | "GROQ_API_KEY";

export function getEnv(name: EnvVar): string {
   const value = Deno.env.get(name);
   if (!value) {
      throw new Error(`Missing env var: ${name}`);
   }
   return value;
}
