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

interface GroqTranscriptionResponse {
   text?: string;
}

const downloadAudioFromStorage = async (voicePath: string): Promise<Blob> => {
   const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(voicePath);

   if (error || !data) {
      console.error("download error:", error);
      throw new Error("Failed to download audio from storage");
   }

   return data as Blob;
};

export const voiceToText = async (
   { voicePath }: VoiceToTextInput,
): Promise<VoiceToTextResult> => {
   console.info("voice_to_text for path:", voicePath);

   const blob = await downloadAudioFromStorage(voicePath);
   const arrayBuffer = await blob.arrayBuffer();

   const file = new File(
      [arrayBuffer],
      "audio.m4a",
      { type: blob.type || "audio/m4a" },
   );

   const form = new FormData();
   form.append("file", file);
   form.append("model", "whisper-large-v3");
   form.append("response_format", "json");
   form.append("temperature", "0");

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
};
