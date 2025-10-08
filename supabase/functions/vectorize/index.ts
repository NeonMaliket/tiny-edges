import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey);
import { pdfToText } from 'npm:pdf-ts';
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
Deno.serve(async (req)=>{
  try {
    const { metadata_id } = await req.json();
    if (!metadata_id) return new Response("Missing metadata_id", {
      status: 400
    });
    const metadata = await loadMetadata(metadata_id);
    const storageFile = await loadDocumentFromStorage(metadata);
    const fileContent = await readFile(metadata, storageFile);
    return new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${metadata.filename}"`,
        "Cache-Control": "no-store",
        "Connection": "keep-alive"
      }
    });
  } catch (err) {
    console.error("Download error:", err);
    return new Response("Error loading file", {
      status: 500
    });
  }
});
