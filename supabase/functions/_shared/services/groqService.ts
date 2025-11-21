// deno-lint-ignore no-unversioned-import
import { GoogleGenAI } from "npm:@google/genai";
import { getEnv } from "../config/env.ts";
import { supabaseAdmin } from "../config/supabaseClient.ts";

const token = getEnv("GROQ_API_KEY");
const supabase = supabaseAdmin;

type Role = "user" | "assistant" | "system";
type MessageType = "TEXT" | "VOICE";

interface ChatSettings {
   is_rag_enabled?: boolean | null;
}

interface ChatMessageContent {
   text?: string | null;
   src?: string | null;
}

interface ChatMessageRow {
   author: Role;
   chat_id: string;
   content: ChatMessageContent | null;
   message_type: string;
   created_at: string;
}

interface VectorMatchRow {
   content: string;
}

interface VoiceToTextEdgeResult {
   transcript: string;
}

const defaultPrompt =
   "{query}\n\nContext information is below, surrounded by ---------------------\n\n---------------------\n{question_answer_context}\n---------------------\n\nGiven the context and provided history information and not prior knowledge,\nreply to the user comment. If the answer is not in the context, inform\nthe user that you can't answer the question.\n";

// --- RAG / embeddings ---

const geminiEmbeding = async (content: string): Promise<number[]> => {
   const ai = new GoogleGenAI({});
   const response = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: content,
   });

   return response.embeddings?.[0]?.values ?? [];
};

const similaritySearch = async (
   userMessageEmbedding: number[],
   chatId: string,
): Promise<VectorMatchRow[]> => {
   const { data, error } = await supabase.rpc("match_vectors", {
      chat_id: chatId,
      query_embedding: userMessageEmbedding,
      match_count: 5,
   });

   if (error) throw new Error(`Similarity error: ${error.message}`);

   return (data ?? []) as VectorMatchRow[];
};

const buildRagContext = (
   userQuery: string,
   embedding: VectorMatchRow[],
): { role: "system"; content: string } => {
   const content = embedding.map((e) => e.content).join("");
   const pattern = defaultPrompt
      .replace("{query}", userQuery)
      .replace("{question_answer_context}", content);

   return {
      role: "system",
      content: pattern,
   };
};

const getChatSettings = async (chatId: string): Promise<ChatSettings> => {
   const { data, error } = await supabase
      .from("chats")
      .select("settings")
      .eq("id", chatId)
      .single();

   if (error) throw error;

   return (data?.settings ?? {}) as ChatSettings;
};

// --- контент сообщения ---

type MessageContentInput = string | ChatMessageContent;

const mapMessageContent = (
   content: MessageContentInput,
   messageType: MessageType,
): ChatMessageContent => {
   console.log("mapMessageContent input:", {
      content,
      messageType,
   });

   if (messageType === "VOICE") {
      const voice = content as ChatMessageContent;
      const mapped: ChatMessageContent = {
         src: voice.src ?? null,
         text: voice.text ?? null,
      };

      console.log("mapMessageContent mapped (VOICE):", mapped);
      return mapped;
   }

   const text = typeof content === "string" ? content : "";
   const mapped: ChatMessageContent = {
      text,
   };

   console.log("mapMessageContent mapped (TEXT/FALLBACK):", mapped);
   return mapped;
};

const saveUserMessage = async (
   content: MessageContentInput,
   chatId: string,
   messageType: MessageType,
): Promise<void> => {
   const mappedContent = mapMessageContent(content, messageType);

   console.log("saveUserMessage payload:", {
      chatId,
      messageType,
      mappedContent,
   });

   const { error } = await supabase.from("chat_messages").insert({
      content: mappedContent,
      created_at: new Date().toISOString(),
      author: "user",
      chat_id: chatId,
      message_type: messageType,
   });

   if (error) console.error("User insert error:", error);
};

// --- история чата ---

const getHistory = async (chatId: string): Promise<
   { role: Role; content: string }[]
> => {
   const resp = await supabase
      .from("chat_messages")
      .select()
      .eq("chat_id", chatId);

   if (resp.error) {
      console.error("getHistory error:", resp.error);
      return [];
   }

   const messages = (resp.data ?? []) as ChatMessageRow[];
   console.log("getHistory raw messages:", messages);

   const history = messages
      .filter((m) => m.content && typeof m.content.text === "string")
      .map((mess) => ({
         role: mess.author,
         content: mess.content?.text ?? "",
      }));

   console.log("getHistory mapped history:", history);
   return history;
};

// --- Groq вызов ---

const fetchModel = async (
   model: string,
   chatId: string,
   prompt: string,
): Promise<Response> => {
   const chatSettings = await getChatSettings(chatId);
   const isRagEnabled = chatSettings?.is_rag_enabled ?? false;

   let ragContext: Array<{ role: "system"; content: string }> = [];

   if (isRagEnabled) {
      const vectorizedPromps = await geminiEmbeding(prompt);
      console.log("Vector:", vectorizedPromps);

      const selectedEmbededText = await similaritySearch(
         vectorizedPromps,
         chatId,
      );
      console.log("Selected embeddings:", selectedEmbededText);

      ragContext = [buildRagContext(prompt, selectedEmbededText)];
   }

   const history = await getHistory(chatId);

   console.log("fetchModel messages payload:", {
      model,
      chatId,
      prompt,
      ragContext,
      history,
   });

   const upstream = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
         method: "POST",
         headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
         },
         body: JSON.stringify({
            model,
            stream: true,
            messages: [
               {
                  role: "system",
                  content: "You are a helpful assistant.",
               },
               ...ragContext,
               ...history,
            ],
         }),
      },
   );

   return upstream;
};

// --- voice_to_text invoke ---

const voiceToText = async (
   voicePath: string,
): Promise<string | undefined> => {
   try {
      console.log("voiceToText invoke with:", voicePath);

      const { data, error } = await supabase.functions.invoke<
         VoiceToTextEdgeResult
      >("voice_to_text", {
         body: {
            voicePath,
         },
      });

      if (error) {
         console.error("Error invoking Edge Function voice_to_text:", error);
         return;
      }

      console.log("voice_to_text Edge Function response:", data);
      return data?.transcript;
   } catch (err) {
      console.error("Unexpected error in voiceToText:", err);
      return;
   }
};

// --- тип тела запроса и общий handler ---

export interface GroqRequestBody {
   chatId: string;
   content: string;
   model?: string;
   messageType?: "TEXT" | "VOICE";
}

export const handleGroqRequest = async (
   body: GroqRequestBody,
): Promise<Response> => {
   try {
      console.log("REQUEST BODY:", body);

      const {
         chatId,
         content,
         model = "llama-3.1-8b-instant",
         messageType = "TEXT",
      } = body;

      console.log("Parsed request:", {
         chatId,
         content,
         model,
         messageType,
      });

      let messageTextForModel: string = content;

      if (messageType === "VOICE") {
         const transcript = await voiceToText(content);
         console.log("voice transcript:", transcript);

         if (transcript && transcript.length > 0) {
            messageTextForModel = transcript;

            const voiceContent: ChatMessageContent = {
               text: messageTextForModel,
               src: content,
            };

            await saveUserMessage(voiceContent, chatId, "VOICE");
         }
      } else {
         await saveUserMessage(content, chatId, "TEXT");
      }

      const upstream = await fetchModel(model, chatId, messageTextForModel);

      if (!upstream.ok || !upstream.body) {
         console.error("Upstream error:", upstream.status, upstream.statusText);
         const errText = await upstream.text().catch(() => "");
         console.error("Upstream body:", errText);

         return new Response("Upstream error", {
            status: 500,
         });
      }

      const encoder = new TextEncoder();
      let fullAnswer = "";

      const stream = new ReadableStream({
         async start(controller) {
            const reader = upstream.body!.getReader();

            while (true) {
               const { done, value } = await reader.read();
               if (done) break;

               const chunk = new TextDecoder().decode(value);
               controller.enqueue(encoder.encode(chunk));

               chunk.split("\n").forEach((line) => {
                  if (!line.startsWith("data:")) return;
                  const payload = line.substring(5).trim();
                  if (payload === "[DONE]") return;

                  try {
                     const data = JSON.parse(payload);
                     const delta: string = data?.choices?.[0]?.delta?.content ??
                        "";
                     if (delta) fullAnswer += delta;
                  } catch {
                     // ignore
                  }
               });
            }

            controller.close();

            console.log("FULL ANSWER:", fullAnswer);

            if (fullAnswer.length > 0) {
               const { error } = await supabase.from("chat_messages").insert({
                  content: {
                     text: fullAnswer,
                  },
                  created_at: new Date().toISOString(),
                  author: "assistant",
                  chat_id: body.chatId,
                  message_type: "TEXT",
               });

               if (error) {
                  console.error("Assistant insert error:", error);
               }
            }
         },
      });

      return new Response(stream, {
         headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Transfer-Encoding": "chunked",
         },
      });
   } catch (e) {
      console.error("UNHANDLED ERROR in groq function:", e);
      return new Response("Internal error", {
         status: 500,
      });
   }
};
