import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai";
// ENV
const token = Deno.env.get("GROQ_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey);
const defaultPrompt =
   "{query}\n\nContext information is below, surrounded by ---------------------\n\n---------------------\n{question_answer_context}\n---------------------\n\nGiven the context and provided history information and not prior knowledge,\nreply to the user comment. If the answer is not in the context, inform\nthe user that you can't answer the question.\n";
// --- RAG / embeddings ---
const geminiEmbeding = async (content) => {
   const ai = new GoogleGenAI({});
   const response = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: content,
   });
   return response.embeddings?.[0]?.values ?? [];
};
const similaritySearch = async (userMessageEmbedding, chatId) => {
   const { data, error } = await supabase.rpc("match_vectors", {
      chat_id: chatId,
      query_embedding: userMessageEmbedding,
      match_count: 5,
   });
   if (error) throw new Error(`Similarity error: ${error.message}`);
   return data;
};
const buildRagContext = (userQuery, embedding) => {
   const content = embedding.map((e) => e.content).join("");
   const pattern = defaultPrompt.replace("{query}", userQuery).replace(
      "{question_answer_context}",
      content,
   );
   return {
      role: "system",
      content: pattern,
   };
};
const getChatSettings = async (chatId) => {
   const { data, error } = await supabase.from("chats").select("settings").eq(
      "id",
      chatId,
   ).single();
   if (error) throw error;
   return data.settings;
};
// --- контент сообщения ---
const mapMessageContent = (content, messageType) => {
   // логируем, что пришло
   console.log("mapMessageContent input:", {
      content,
      messageType,
   });
   if (messageType === "VOICE") {
      const mapped = {
         src: content.src ?? null,
         text: content.text ?? null,
      };

      console.log("mapMessageContent mapped (VOICE):", mapped);
      return mapped;
   }
   const mapped = {
      text: content ?? "",
   };
   console.log("mapMessageContent mapped (TEXT/FALLBACK):", mapped);
   return mapped;
};
const saveUserMessage = async (content, chatId, messageType) => {
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
const getHistory = async (chatId) => {
   const resp = await supabase.from("chat_messages").select().eq(
      "chat_id",
      chatId,
   );
   if (resp.error) {
      console.error("getHistory error:", resp.error);
      return [];
   }
   const messages = resp.data ?? [];
   console.log("getHistory raw messages:", messages);
   const history = messages.filter((m) =>
      m.content && typeof m.content.text === "string"
   ).map((mess) => ({
      role: mess.author,
      content: mess.content.text,
   }));
   console.log("getHistory mapped history:", history);
   return history;
};
// --- Groq вызов ---
const fetchModel = async (model, chatId, prompt) => {
   const chatSettings = await getChatSettings(chatId);
   const isRagEnabled = chatSettings?.is_rag_enabled ?? false;
   let ragContext = [];
   if (isRagEnabled) {
      const vectorizedPromps = await geminiEmbeding(prompt);
      console.log("Vector:", vectorizedPromps);
      const selectedEmbededText = await similaritySearch(
         vectorizedPromps,
         chatId,
      );
      console.log("Selected embeddings:", selectedEmbededText);
      ragContext = [
         buildRagContext(prompt, selectedEmbededText),
      ];
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
// --- voice_to_text ---
const voiceToText = async (voicePath) => {
   try {
      console.log("voiceToText invoke with:", voicePath);
      const { data, error } = await supabase.functions.invoke("voice_to_text", {
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
   }
};
// --- основной handler ---
serve(async (req) => {
   try {
      const body = await req.json();
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
      // текст для модели (для VOICE сначала расшифровываем)
      let messageTextForModel = content;
      if (messageType === "VOICE") {
         const transcript = await voiceToText(content);
         console.log("voice transcript:", transcript);
         if (transcript && transcript.length > 0) {
            messageTextForModel = transcript;
            const voiceContent = {
               src: content,
               text: messageTextForModel,
            };
            await saveUserMessage(voiceContent, chatId, messageType);
         }
      } else {
         await saveUserMessage(content, chatId, messageType);
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
            const reader = upstream.body.getReader();
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
                     const delta = data?.choices?.[0]?.delta?.content ?? "";
                     if (delta) fullAnswer += delta;
                  } catch (_) {
                     // игнор
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
                  chat_id: chatId,
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
});
