import "@supabase/functions-js/edge-runtime.d.ts";
import {
  voiceToText,
  VoiceToTextInput,
} from "../_shared/services/voiceToTextService.ts";
import { requireAuth } from "../_shared/auth.ts";

console.info("voice_to_text server started");

Deno.serve(
  requireAuth<VoiceToTextInput>(async (_req, body, _user) => {
    const result = await voiceToText(body);

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
    });
  }),
);
