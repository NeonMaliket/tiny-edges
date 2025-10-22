import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai";
const token = Deno.env.get("GROQ_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey);
const defaultPrompt = "{query}\n\nContext information is below, surrounded by ---------------------\n\n---------------------\n{question_answer_context}\n---------------------\n\nGiven the context and provided history information and not prior knowledge,\nreply to the user comment. If the answer is not in the context, inform\nthe user that you can't answer the question.\n";
const geminiEmbeding = async (content)=>{
  const ai = new GoogleGenAI({});
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: content
  });
  return response.embeddings?.[0]?.values ?? [];
};
const similaritySearch = async (userMessageEmbedding, chatId)=>{
  const { data, error } = await supabase.rpc("match_vectors", {
    chat_id: chatId,
    query_embedding: userMessageEmbedding,
    match_count: 5
  });
  if (error) throw new Error(`Similarity error: ${error.message}`);
  return data;
};
const buildRagContext = (userQuery, embedding)=>{
  const content = embedding.map((e)=>e.content).join('');
  const pattern = defaultPrompt.replace('{query}', userQuery).replace('{question_answer_context}', content);
  return {
    role: "system",
    content: pattern
  };
};
const getChatSettings = async (chatId)=>{
  const { data, error } = await supabase.from('chats').select('settings').eq('id', chatId).single();
  if (error) throw error;
  return data.settings;
};
serve(async (req)=>{
  const { chatId, prompt, model = "llama-3.1-8b-instant" } = await req.json();
  const vectorizedPromps = await geminiEmbeding(prompt);
  const chatSettings = await getChatSettings(chatId);
  console.log('hat settings: ', chatSettings);
  console.log('Vector: ', vectorizedPromps);
  const selectedEmbededText = await similaritySearch(vectorizedPromps, chatId);
  console.log('Selected embeddings: ', selectedEmbededText);
  const isRagEnabled = chatSettings?.is_rag_enabled ?? false;
  const ragContext = isRagEnabled ? buildRagContext(prompt, selectedEmbededText) : null;
  console.log('RAG CONTEXT: ', ragContext);
  {
    const { error } = await supabase.from("chat_messages").insert({
      content: prompt,
      created_at: new Date().toISOString(),
      author: "user",
      chat_id: chatId
    });
    if (error) console.error("User insert error:", error);
  }
  const history = await supabase.from("chat_messages").select().eq("chat_id", chatId).then((resp)=>{
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
        {
          role: "system",
          content: "You are a helpful assistant."
        },
        ...ragContext ? [
          ragContext
        ] : [],
        ...history,
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
