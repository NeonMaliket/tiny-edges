// supabase/functions/voice_to_text/index.ts

// deno-lint-ignore no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
   voiceToText,
   VoiceToTextInput,
} from "../_shared/services/voiceToTextService.ts";
import { createJsonHandler } from "../_shared/http.ts";

console.info("voice_to_text server started");

Deno.serve(
   createJsonHandler<VoiceToTextInput>(async (_req, body) => {
      const result = await voiceToText(body);

      return new Response(JSON.stringify(result), {
         headers: {
            "Content-Type": "application/json",
            Connection: "keep-alive",
         },
      });
   }),
);
