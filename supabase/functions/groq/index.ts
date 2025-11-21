// supabase/functions/groq/index.ts

// deno-lint-ignore no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
   GroqRequestBody,
   handleGroqRequest,
} from "../_shared/services/groqService.ts";

Deno.serve(async (req: Request): Promise<Response> => {
   const body = (await req.json()) as GroqRequestBody;
   return handleGroqRequest(body);
});
