import "@supabase/functions-js/edge-runtime.d.ts";
import {
  GroqRequestBody,
  handleGroqRequest,
} from "../_shared/services/groqService.ts";
import { requireAuth } from "../_shared/auth.ts";

Deno.serve(
  requireAuth<GroqRequestBody>((_req, body, _user) => {
    return handleGroqRequest(body);
  }),
);
