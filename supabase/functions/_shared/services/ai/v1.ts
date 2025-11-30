import { groqClient } from "../../config/groq.ts";
import { supabaseAdmin } from "../../config/supabaseClient.ts";
import { AiRequest, Message, Role, SavedMessage } from "../../types/ai.ts";

const supabase = supabaseAdmin;
type ChatCompletionMessageParam = {
   role: Role;
   content: string;
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

   const completionMessages = ((resp.data ?? []).slice().reverse())
      .map((msg) => ({
         role: msg.author as Role,
         content: (msg.content?.text ?? "").trim(),
      }))
      .filter((m) => m.content.length > 0);
   return completionMessages;
};

const saveMessage = async (message: Message): Promise<SavedMessage> => {
   console.log("Saving message:", message);
   const { data, error } = await supabase.from("chat_messages").insert(
      {
         content: message.content,
         message_type: message.message_type,
         author: message.author,
         chat_id: message.chat_id,
      },
   )
      .select().single();

   if (error) console.error("User insert error:", error);

   console.log("Inserted message:", data);

   if (!data) {
      throw new Error("Failed to save message.");
   }

   return data;
};

export const aiServiceV1 = async (request: AiRequest): Promise<Response> => {
   console.log("AI Service V1 Request:", request);
   const history: ChatCompletionMessageParam[] = await chatHistory(
      request.message.chat_id,
   );
   const userMessage: SavedMessage = await saveMessage(request.message);
   const llmResponse = await groqClient.chat.completions.create({
      model: request.model,
      messages: [
         ...history,
         {
            role: "user",
            content: userMessage.content.text,
         },
      ],
      temperature: request.chat_settings.ai_options.temperature,
      top_p: request.chat_settings.ai_options.top_p,
      max_tokens: request.chat_settings.ai_options.max_tokens,
   });
   const reply = llmResponse.choices[0]?.message?.content ??
      "[No response from LLM.]";
   const message: Message = {
      content: {
         text: reply,
      },
      message_type: "text",
      author: "assistant",
      chat_id: request.message.chat_id,
   };
   const savedReply: SavedMessage = await saveMessage(message);
   return new Response(
      JSON.stringify({ reply: savedReply }),
      { status: 200, headers: { "Content-Type": "application/json" } },
   );
};
