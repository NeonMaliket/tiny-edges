// supabase/functions/_shared/services/voiceToTextService.ts

import { supabaseAdmin } from "../config/supabaseClient.ts";
import { getEnv } from "../config/env.ts";

const BUCKET = "storage";
const GROQ_API_KEY = getEnv("GROQ_API_KEY");
const GROQ_TRANSCRIPT_URL =
   "https://api.groq.com/openai/v1/audio/transcriptions";

export interface VoiceToTextInput {
   voicePath: string;
}

export interface VoiceToTextResult {
   transcript: string;
}

interface SignedUrlData {
   signedUrl: string;
}

interface GroqTranscriptionResponse {
   text?: string;
}

export async function voiceToText(
   { voicePath }: VoiceToTextInput,
): Promise<VoiceToTextResult> {
   console.info("voice_to_text for path:", voicePath);

   const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(voicePath, 60);

   if (error) {
      console.error("createSignedUrl error:", error);
      throw new Error("Failed to create signed URL for audio");
   }

   const signedUrl = (data as SignedUrlData | null)?.signedUrl;
   if (!signedUrl) {
      throw new Error("Signed URL is empty");
   }

   const form = new FormData();
   form.append("model", "whisper-large-v3");
   form.append("url", signedUrl);
   form.append("response_format", "json");

   const resp = await fetch(GROQ_TRANSCRIPT_URL, {
      method: "POST",
      headers: {
         Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: form,
   });

   if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(
         "Groq transcription error:",
         resp.status,
         resp.statusText,
         errText,
      );
      throw new Error("Groq transcription failed");
   }

   const json = (await resp.json()) as GroqTranscriptionResponse;
   const transcript = json.text ?? "";

   console.info("voice_to_text transcript:", transcript);

   return { transcript };
}
