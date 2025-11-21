// supabase/functions/_shared/services/voiceToTextService.ts

export interface VoiceToTextInput {
   voicePath: string;
}

export interface VoiceToTextResult {
   transcript: string;
}

// deno-lint-ignore require-await
export async function voiceToText(
   { voicePath }: VoiceToTextInput,
): Promise<VoiceToTextResult> {
   console.info("voice_to_text for path:", voicePath);

   // здесь у тебя пока stub
   return {
      transcript: "Hello how are you.",
   };
}
