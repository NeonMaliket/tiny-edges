import "@supabase/functions-js/edge-runtime.d.ts";
import { handleAiRequest } from "../_shared/services/ai/ai_service.ts";
import { AiRequest } from "../_shared/types/ai.ts";
import { requireAuth } from "../_shared/auth.ts";

Deno.serve(
  requireAuth<AiRequest>((_req, body, _user) => {
    return handleAiRequest(body);
  }),
);
