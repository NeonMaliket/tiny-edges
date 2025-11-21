import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pdfToText } from "npm:pdf-ts";
import { GoogleGenAI } from "npm:@google/genai";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey);
const getFileTypeFromPath = (path) => {
   const ext = path.split(".").pop()?.toLowerCase() ?? "txt";
   return ext;
};
const loadDocumentFromStorage = async (bucket, path) => {
   const { data, error } = await supabase.storage.from(bucket).download(path);
   if (error || !data) {
      throw new Error(`Storage download error: ${error?.message}`);
   }
   return data;
};
const readTextFile = async (resource) => {
   return new TextDecoder("utf-8").decode(await resource.arrayBuffer());
};
const readPdfFile = async (resource) => {
   const buffer = await resource.arrayBuffer();
   return await pdfToText(buffer);
};
const splitContent = (text, chunkSize = 1000, overlap = 200) => {
   const chunks = [];
   for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const chunk = text.slice(i, i + chunkSize).trim();
      if (chunk) chunks.push(chunk);
   }
   return chunks;
};
const readFile = async (fielType, resource) => {
   switch (fielType) {
      case "txt":
         return splitContent(await readTextFile(resource));
      case "pdf":
         return splitContent(await readPdfFile(resource));
      default:
         throw new Error(`Unsupported file type: ${fielType}`);
   }
};
const geminiEmbedding = async (contents) => {
   if (!contents.length) throw new Error("No content to embed");
   const ai = new GoogleGenAI({});
   const embeddings = [];
   for (let i = 0; i < contents.length; i += 100) {
      const batch = contents.slice(i, i + 100);
      const response = await ai.models.embedContent({
         model: "gemini-embedding-001",
         contents: batch,
      });
      if (response.embeddings?.length) embeddings.push(...response.embeddings);
   }
   return embeddings;
};
const storeEmbeddings = async (
   embeddings,
   contents,
   bucket,
   path,
   batchSize = 100,
) => {
   if (embeddings.length !== contents.length) {
      throw new Error("Embeddings and contents length mismatch");
   }
   const objectId = await getObjectId(bucket, path);
   for (let i = 0; i < embeddings.length; i += batchSize) {
      const batchEmbeddings = embeddings.slice(i, i + batchSize);
      const batchContents = contents.slice(i, i + batchSize);
      const rows = batchEmbeddings.map((embedding, j) => ({
         object_id: objectId,
         content: batchContents[j],
         vector_data: embedding.values ?? embedding,
         created_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("vector_store").insert(rows);
      if (error) throw new Error(`Insert error: ${error.message}`);
   }
};
const getObjectId = async (bucket, path) => {
   const { data, error } = await supabase.from("v_storage_objects").select("id")
      .eq("bucket_id", bucket).eq("name", path).single();
   if (error) throw error;
   return data?.id;
};
Deno.serve(async (req) => {
   try {
      const { bucket, path } = await req.json();
      if (!bucket || !path) {
         return new Response("Missing bucket or path", {
            status: 400,
         });
      }
      const fielType = getFileTypeFromPath(path);
      const blob = await loadDocumentFromStorage(bucket, path);
      const contentChunks = await readFile(fielType, blob);
      const embeddings = await geminiEmbedding(contentChunks);
      await storeEmbeddings(embeddings, contentChunks, bucket, path);
      return new Response("ok", {
         status: 200,
      });
   } catch (err) {
      console.error("Edge function error:", err);
      return new Response("Error processing file", {
         status: 500,
      });
   }
});
