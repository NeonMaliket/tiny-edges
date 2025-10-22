import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pdfToText } from 'npm:pdf-ts';
import { GoogleGenAI } from "npm:@google/genai";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey);
const loadMetadata = async (metadata_id)=>{
  const { data, error } = await supabase.from("document_metadata").select("bucket, file_name, document_type:type").eq("id", metadata_id).single();
  if (error || !data) throw new Error(`Metadata not found: ${error?.message}`);
  return {
    id: metadata_id,
    bucket: data.bucket,
    filename: data.file_name,
    document_type: data.document_type
  };
};
const loadDocumentFromStorage = async (metadata)=>{
  const { data, error } = await supabase.storage.from(metadata.bucket).download(`${metadata.id}`);
  if (error || !data) throw new Error(`Storage download error: ${error?.message}`);
  return data;
};
const readTextFile = async (metadata, resource)=>{
  const text = new TextDecoder("utf-8").decode(await resource.arrayBuffer());
  console.log(`Read text file: ${metadata.filename}`);
  return text;
};
const readPdfFile = async (_, resource)=>{
  const buffer = await resource.arrayBuffer();
  const result = await pdfToText(buffer);
  return result;
};
const splitContent = (text, chunkSize = 1000, overlap = 200)=>{
  const chunks = [];
  for(let i = 0; i < text.length; i += chunkSize - overlap){
    const chunk = text.slice(i, i + chunkSize);
    chunks.push(chunk.trim());
  }
  return chunks.filter(Boolean);
};
const readFile = async (metadata, resource)=>{
  const handlers = {
    txt: readTextFile,
    pdf: readPdfFile
  };
  const content = await handlers[metadata.document_type](metadata, resource);
  return splitContent(content);
};
const geminiEmbedding = async (contents)=>{
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new Error("No content to embed");
  }
  const ai = new GoogleGenAI({});
  const embeddings = [];
  for(let i = 0; i < contents.length; i += 100){
    const chunk = contents.slice(i, i + 100);
    const response = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: chunk
    });
    if (response.embeddings?.length) {
      embeddings.push(...response.embeddings);
    }
  }
  return embeddings;
};
const storeEmbeddings = async (embeddings, contents, metadata, batchSize = 100)=>{
  if (embeddings.length !== contents.length) {
    throw new Error("Embeddings and contents length mismatch");
  }
  for(let i = 0; i < embeddings.length; i += batchSize){
    const batchEmbeddings = embeddings.slice(i, i + batchSize);
    const batchContents = contents.slice(i, i + batchSize);
    const rows = batchEmbeddings.map((embedding, j)=>({
        metadata_id: metadata.id,
        content: batchContents[j],
        vector_data: embedding.values ?? embedding,
        created_at: new Date().toISOString()
      }));
    const { error } = await supabase.from("vector_store").insert(rows);
    if (error) throw new Error(`Insert error: ${error.message}`);
  }
};
const checkIfExists = async (metadata_id)=>{
  const { data, error } = await supabase.from("vector_store").select("id").eq("metadata_id", metadata_id).maybeSingle();
  if (error) throw new Error(`Check error: ${error.message}`);
  return !!data;
};
Deno.serve(async (req)=>{
  try {
    const { metadata_id } = await req.json();
    if (!metadata_id) return new Response("Missing metadata_id", {
      status: 400
    });
    const exists = await checkIfExists(metadata_id);
    if (exists) {
      return new Response(JSON.stringify({
        status: "exists"
      }), {
        status: 409,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const metadata = await loadMetadata(metadata_id);
    const storageFile = await loadDocumentFromStorage(metadata);
    const fileContent = await readFile(metadata, storageFile);
    const embeddings = await geminiEmbedding(fileContent);
    storeEmbeddings(embeddings, fileContent, metadata);
    return new Response();
  } catch (err) {
    console.error("Download error:", err);
    return new Response("Error loading file", {
      status: 500
    });
  }
});
