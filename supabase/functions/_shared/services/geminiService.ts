import { GoogleGenAI } from "npm:@google/genai@1.30.0";

export const geminiEmbedding = async (text: string): Promise<number[]> => {
   const ai = new GoogleGenAI({});
   const resp = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
   });
   return resp.embeddings?.[0]?.values ?? [];
};
