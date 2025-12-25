import { groqClient } from "../../config/groq.ts";
import { supabaseAdmin } from "../../config/supabaseClient.ts";
import { AiRequest, Message, Role, SavedMessage } from "../../types/ai.ts";
import { geminiEmbedding } from "../geminiService.ts";

const supabase = supabaseAdmin;

type ChatCompletionMessageParam = {
   role: Role;
   content: string;
};

type VectorMatchRow = { content: string };
type VoiceToTextEdgeResult = { transcript: string };

const DEFAULT_RAG_PROMPT =
   "{query}\n\nContext information is below, surrounded by ---------------------\n\n---------------------\n{question_answer_context}\n---------------------\n\nGiven the context and provided history information and not prior knowledge,\nreply to the user comment. If the answer is not in the context, inform\nthe user that you can't answer the question.\n";

const voiceToText = async (
   voicePath: string,
   userToken: string,
): Promise<string> => {
   console.log("[voiceToText] invoke voice_to_text:", { voicePath });

   const { data, error } = await supabase.functions.invoke<
      VoiceToTextEdgeResult
   >(
      "voice_to_text",
      {
         body: { voicePath },
         headers: {
            Authorization: `Bearer ${userToken}`,
         },
      },
   );

   if (error) {
      console.error("[voiceToText] error:", error);
      throw error;
   }

   const transcript = (data?.transcript ?? "").trim();
   console.log("[voiceToText] transcript length:", transcript.length);

   return transcript;
};

const saveMessage = async (message: Message): Promise<SavedMessage> => {
   console.log("[saveMessage] start:", message);

   const { data, error } = await supabase
      .from("chat_messages")
      .insert({
         content: message.content,
         message_type: message.message_type,
         author: message.author,
         chat_id: message.chat_id,
      })
      .select()
      .single();

   if (error) {
      console.error("[saveMessage] insert error:", error);
   }

   if (!data) {
      console.error("[saveMessage] no data returned");
      throw new Error("Failed to save message.");
   }
   return data;
};

const prepareIncomingMessage = async (
   incoming: Message,
   userToken: string,
): Promise<{ saved: SavedMessage; textForLlm: string }> => {
   console.log("[prepareIncomingMessage] start:", {
      chat_id: incoming.chat_id,
      type: incoming.message_type,
      hasText: Boolean(incoming.content?.text),
      hasSrc: Boolean(incoming.content?.src),
   });

   switch (incoming.message_type) {
      case "voice": {
         const voicePath = incoming.content.src ?? "";
         console.log("[prepareIncomingMessage] voice path:", { voicePath });

         const transcript = await voiceToText(voicePath, userToken);
         console.log(
            "[prepareIncomingMessage] voice transcript length:",
            transcript.length,
         );

         const saved = await saveMessage({
            ...incoming,
            content: { text: transcript, src: voicePath },
         });

         return { saved, textForLlm: transcript };
      }

      case "text":
      default: {
         const saved = await saveMessage(incoming);
         const textForLlm = (saved.content.text ?? "").trim();

         console.log("[prepareIncomingMessage] saved text msg:", saved);

         return { saved, textForLlm };
      }
   }
};

const similaritySearch = async (
   chatId: number,
   queryEmbedding: number[],
   matchCount = 5,
): Promise<VectorMatchRow[]> => {
   console.log("[similaritySearch] start:", {
      chatId,
      embeddingLen: queryEmbedding.length,
      matchCount,
   });

   const { data, error } = await supabase.rpc("match_vectors", {
      chat_id: chatId,
      query_embedding: queryEmbedding,
      match_count: matchCount,
   });

   if (error) {
      console.error("[similaritySearch] rpc error:", error);
      throw new Error(`Similarity error: ${error.message}`);
   }

   const rows = (data ?? []) as VectorMatchRow[];
   console.log("[similaritySearch] matches:", rows.length);

   return rows;
};

const buildRagContextMessage = async (
   chatId: number,
   userQuery: string,
): Promise<ChatCompletionMessageParam | null> => {
   console.log("[RAG] start:", {
      chatId,
      queryLen: userQuery.length,
   });

   const emb = await geminiEmbedding(userQuery);
   console.log("[RAG] embedding len:", emb.length);

   if (emb.length === 0) {
      console.log("[RAG] empty embedding => skip");
      return null;
   }

   const matches = await similaritySearch(chatId, emb, 5);
   if (matches.length === 0) {
      console.log("[RAG] no matches => skip");
      return null;
   }

   const context = matches.map((m) => m.content).join("\n");
   console.log("[RAG] context chars:", context.length);

   const content = DEFAULT_RAG_PROMPT
      .replace("{query}", userQuery)
      .replace("{question_answer_context}", context);

   console.log("[RAG] system prompt chars:", content.length);
   return { role: "system", content };
};

const chatHistory = async (
   chatId: number,
): Promise<ChatCompletionMessageParam[]> => {
   console.log("[chatHistory] start:", { chatId });

   const resp = await supabase
      .from("chat_messages")
      .select("author, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(10);

   if (resp.error) {
      console.error("[chatHistory] error:", resp.error);
      return [];
   }

   const history = ((resp.data ?? []).slice().reverse())
      .map((msg) => ({
         role: msg.author as Role,
         content: (msg.content?.text ?? "").trim(),
      }))
      .filter((m) => m.content.length > 0);

   console.log("[chatHistory] loaded:", {
      raw: resp.data?.length ?? 0,
      filtered: history.length,
   });

   return history;
};

export const aiServiceV1 = async (
   request: AiRequest,
   user: { id: string; token: string },
): Promise<Response> => {
   console.log("[aiServiceV1] start:", {
      chatId: request.message.chat_id,
      model: request.model,
      rag: request.chat_settings.is_rag_enabled,
      type: request.message.message_type,
   });

   const history = await chatHistory(request.message.chat_id);

   const prepared = await prepareIncomingMessage(
      request.message,
      user.token,
   );
   const userText = prepared.textForLlm;

   console.log("[aiServiceV1] userText:", { len: userText.length });

   const ragMsg = request.chat_settings.is_rag_enabled === true
      ? await buildRagContextMessage(request.message.chat_id, userText)
      : null;

   console.log("[aiServiceV1] messages payload:", {
      ragIncluded: Boolean(ragMsg),
      historyCount: history.length,
      total: (ragMsg ? 1 : 0) + history.length + 1,
   });

   const llmResponse = await groqClient.chat.completions.create({
      model: request.model,
      messages: [
         ...(ragMsg ? [ragMsg] : []),
         ...history,
         { role: "user", content: userText || "User said nothing." },
      ],
      temperature: request.chat_settings.ai_options.temperature,
      top_p: request.chat_settings.ai_options.top_p,
      max_tokens: request.chat_settings.ai_options.max_tokens,
   });

   const reply = llmResponse.choices[0]?.message?.content ??
      "[No response from LLM.]";
   console.log("[aiServiceV1] llm reply:", { len: reply.length });

   const savedReply = await saveMessage({
      content: { text: reply },
      message_type: "text",
      author: "assistant",
      chat_id: request.message.chat_id,
   });

   return new Response(JSON.stringify({ reply: savedReply }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
   });
};
