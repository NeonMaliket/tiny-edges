import { groqClient } from "../../config/groq.ts";
import { supabaseAdmin } from "../../config/supabaseClient.ts";
import { AiRequest, Message, SavedMessage } from "../../types/ai.ts";

const supabase = supabaseAdmin;

const saveMessage = async (message: Message): Promise<SavedMessage> => {
   const { data, error } = await supabase.from("chat_messages").insert(message)
      .select().single();

   if (error) console.error("User insert error:", error);

   console.log("Inserted message:", data);

   return data;
};

export const aiServiceV1 = async (request: AiRequest): Promise<Response> => {
   const userMessage: Message = await saveMessage(request.message);
   const llmResponse = await groqClient.chat.completions.create({
      model: request.model,
      messages: [
         {
            role: "user",
            content: userMessage.content.text ?? "User said nothing.",
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
