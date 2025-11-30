import { groqClient } from "../../config/groq.ts";
import { AiRequest } from "../../types/ai.ts";

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
   return new Response(
      JSON.stringify({ reply: llmResponse }),
      { status: 200, headers: { "Content-Type": "application/json" } },
   );
};
