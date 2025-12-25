import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
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
