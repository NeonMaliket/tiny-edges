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

const DEFAULT_RAG_PROMPT =
   "{query}\n\nContext information is below, surrounded by ---------------------\n\n---------------------\n{question_answer_context}\n---------------------\n\nGiven the context and provided history information and not prior knowledge,\nreply to the user comment. If the answer is not in the context, inform\nthe user that you can't answer the question.\n";

const similaritySearch = async (
   chatId: number,
   queryEmbedding: number[],
   matchCount = 5,
): Promise<VectorMatchRow[]> => {
   const { data, error } = await supabase.rpc("match_vectors", {
      chat_id: chatId,
      query_embedding: queryEmbedding,
      match_count: matchCount,
   });

   if (error) throw new Error(`Similarity error: ${error.message}`);
   return (data ?? []) as VectorMatchRow[];
};

const buildRagContextMessage = async (
   chatId: number,
   userQuery: string,
   isEnabled: boolean,
): Promise<ChatCompletionMessageParam | null> => {
   if (!isEnabled) return null;

   const emb = await geminiEmbedding(userQuery);
   if (emb.length === 0) return null;

   const matches = await similaritySearch(chatId, emb, 5);
   if (matches.length === 0) return null;

   const context = matches.map((m) => m.content).join("\n");
   const content = DEFAULT_RAG_PROMPT
      .replace("{query}", userQuery)
      .replace("{question_answer_context}", context);

   return { role: "system", content };
};

const chatHistory = async (
   chatId: number,
): Promise<ChatCompletionMessageParam[]> => {
   const resp = await supabase
      .from("chat_messages")
      .select("author, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(10);

   if (resp.error) {
      console.error("getHistory error:", resp.error);
      return [];
   }

   return ((resp.data ?? []).slice().reverse())
      .map((msg) => ({
         role: msg.author as Role,
         content: (msg.content?.text ?? "").trim(),
      }))
      .filter((m) => m.content.length > 0);
};

const saveMessage = async (message: Message): Promise<SavedMessage> => {
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

   if (error) console.error("User insert error:", error);
   if (!data) throw new Error("Failed to save message.");

   return data;
};

export const aiServiceV1 = async (request: AiRequest): Promise<Response> => {
   const history = await chatHistory(request.message.chat_id);

   const userMessage = await saveMessage(request.message);
   const userText = (userMessage.content.text ?? "").trim();

   const isRagEnabled = request.chat_settings.is_rag_enabled;
   const ragMsg = isRagEnabled
      ? await buildRagContextMessage(
         request.message.chat_id,
         userText,
         request.chat_settings.is_rag_enabled === true,
      )
      : null;

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
