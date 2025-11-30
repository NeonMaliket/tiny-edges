import { groqClient } from "../../config/groq.ts";
import { AiRequest, Message } from "../../types/ai.ts";

export const aiServiceV1 = async (request: AiRequest): Promise<Response> => {
   const llmResponse = await groqClient.chat.completions.create({
      model: request.model,
      messages: [
         {
            role: "user",
            content: request.message.content.text ?? "User said nothing.",
         },
      ],
      temperature: request.chat_settings.ai_options.temperature,
      top_p: request.chat_settings.ai_options.top_p,
      max_tokens: request.chat_settings.ai_options.max_tokens,
   });
   const reply = llmResponse.choices[0]?.message?.content ??
      "[No response from LLM.]";
   const message: Message = {
      created_at: new Date(),
      content: {
         text: reply,
      },
      message_type: "text",
      author: "assistant",
      chat_id: request.message.chat_id,
   };
   return new Response(
      JSON.stringify({ reply: message }),
      { status: 200, headers: { "Content-Type": "application/json" } },
   );
};
