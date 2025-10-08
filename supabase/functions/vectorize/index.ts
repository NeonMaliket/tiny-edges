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
  const { data, error } = await supabase.storage.from(metadata.bucket).download(metadata.id);
  if (error || !data) throw new Error(`Storage download error: ${error?.message}`);
  return data;
};
const readTextFile = async (metadata, resource)=>{
  const text = new TextDecoder("utf-8").decode(await resource.arrayBuffer());
  console.log(`Read text file: ${metadata.filename}`);
  return text;
};
const readPdfFile = async (metadata, resource)=>{
  const buffer = await resource.arrayBuffer();
  const result = await pdfToText(buffer);
  return result.replaceAll(/\n/g, " ");
};
const readFile = async (metadata, resource)=>{
  const handlers = {
    txt: readTextFile,
    pdf: readPdfFile
  };
  return handlers[metadata.document_type](metadata, resource);
};
const geminiEmbeding = async (content)=>{
  const ai = new GoogleGenAI({});
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: content
  });
  return response.embeddings?.[0]?.values ?? [];
};
const storeEmbedding = async (embedding, metadata)=>{
  const { error } = await supabase.from("vector_store").insert({
    metadata_id: metadata.id,
    content: metadata.filename,
    vector_data: embedding,
    created_at: new Date().toISOString()
  });
  if (error) throw new Error(`Insert error: ${error.message}`);
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
    const embeddings = await geminiEmbeding(fileContent);
    storeEmbedding(embeddings, metadata);
    return new Response();
  } catch (err) {
    console.error("Download error:", err);
    return new Response("Error loading file", {
      status: 500
    });
  }
});
