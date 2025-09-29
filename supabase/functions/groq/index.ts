import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const token = Deno.env.get("GROQ_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey);
serve(async (req)=>{
  const { chatId, prompt, model = "llama-3.1-8b-instant" } = await req.json();
  {
    const { error } = await supabase.from("chat_messages").insert({
      content: prompt,
      created_at: new Date().toISOString(),
      author: "user",
      chat_id: chatId
    });
    if (error) console.error("User insert error:", error);
  }
  const history = await supabase.from("chat_messages").select().then((resp)=>{
    const messages = resp.data;
    console.log('MESSAGE: ', messages);
    return messages.map((mess)=>{
      return {
        role: mess.author,
        content: mess.content
      };
    });
  });
  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        ...history,
        {
          role: "system",
          content: "You are a helpful assistant."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });
  const encoder = new TextEncoder();
  let fullAnswer = "";
  const stream = new ReadableStream({
    async start (controller) {
      const reader = upstream.body.getReader();
      while(true){
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = new TextDecoder().decode(value);
        controller.enqueue(encoder.encode(chunk));
        // копим только текстовые чанки
        chunk.split("\n").forEach((line)=>{
          if (line.startsWith("data:")) {
            const payload = line.substring(5).trim();
            if (payload === "[DONE]") return;
            try {
              const data = JSON.parse(payload);
              const delta = data?.choices?.[0]?.delta?.content ?? "";
              if (delta) fullAnswer += delta;
            } catch (_) {}
          }
        });
      }
      controller.close();
      // 4. сохраняем полный ответ ассистента
      if (fullAnswer.length > 0) {
        const { error } = await supabase.from("chat_messages").insert({
          content: fullAnswer,
          created_at: new Date().toISOString(),
          author: "assistant",
          chat_id: chatId
        });
        if (error) console.error("Assistant insert error:", error);
      }
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked"
    }
  });
});
