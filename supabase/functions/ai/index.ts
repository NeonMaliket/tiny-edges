// deno-lint-ignore no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleAiRequest } from "../_shared/services/ai/ai_service.ts";
import { AiRequest } from "../_shared/types/ai.ts";

Deno.serve(async (req: Request): Promise<Response> => {
   const body = (await req.json()) as AiRequest;
   return handleAiRequest(body);
});
