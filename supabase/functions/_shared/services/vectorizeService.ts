// supabase/functions/_shared/services/vectorizeService.ts

import { supabaseAdmin } from "../config/supabaseClient.ts";
// deno-lint-ignore no-unversioned-import
import { pdfToText } from "npm:pdf-ts";
// deno-lint-ignore no-unversioned-import
import { GoogleGenAI } from "npm:@google/genai";

const supabase = supabaseAdmin;

interface StorageObjectRow {
   id: string;
}

interface GeminiEmbedding {
   values?: number[];
}

export interface VectorizeRequest {
   bucket: string;
   path: string;
}

const getFileTypeFromPath = (path: string): string => {
   const ext = path.split(".").pop()?.toLowerCase() ?? "txt";
   return ext;
};

const loadDocumentFromStorage = async (
   bucket: string,
   path: string,
): Promise<Blob> => {
   const { data, error } = await supabase.storage.from(bucket).download(path);

   if (error || !data) {
      throw new Error(`Storage download error: ${error?.message}`);
   }

   return data as Blob;
};

const readTextFile = async (resource: Blob): Promise<string> => {
   const buffer = await resource.arrayBuffer();
   return new TextDecoder("utf-8").decode(buffer);
};

const readPdfFile = async (resource: Blob): Promise<string> => {
   const buffer = await resource.arrayBuffer();
   const uint8 = new Uint8Array(buffer); // pdfToText ждёт Uint8Array / Buffer
   return await pdfToText(uint8);
};

const splitContent = (
   text: string,
   chunkSize = 1000,
   overlap = 200,
): string[] => {
   const chunks: string[] = [];

   for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const chunk = text.slice(i, i + chunkSize).trim();
      if (chunk) chunks.push(chunk);
   }

   return chunks;
};

const readFile = async (
   fileType: string,
   resource: Blob,
): Promise<string[]> => {
   switch (fileType) {
      case "txt":
         return splitContent(await readTextFile(resource));
      case "pdf":
         return splitContent(await readPdfFile(resource));
      default:
         throw new Error(`Unsupported file type: ${fileType}`);
   }
};

const geminiEmbedding = async (
   contents: string[],
): Promise<GeminiEmbedding[]> => {
   if (!contents.length) throw new Error("No content to embed");

   const ai = new GoogleGenAI({});
   const embeddings: GeminiEmbedding[] = [];

   for (let i = 0; i < contents.length; i += 100) {
      const batch = contents.slice(i, i + 100);

      const response = await ai.models.embedContent({
         model: "gemini-embedding-001",
         contents: batch,
      });

      if (response.embeddings?.length) {
         embeddings.push(...response.embeddings);
      }
   }

   return embeddings;
};

const getObjectId = async (
   bucket: string,
   path: string,
): Promise<string> => {
   const { data, error } = await supabase
      .from("v_storage_objects")
      .select("id")
      .eq("bucket_id", bucket)
      .eq("name", path)
      .single();

   if (error) throw error;
   if (!data) throw new Error("Object not found");

   const row = data as StorageObjectRow;
   return row.id;
};

const storeEmbeddings = async (
   embeddings: GeminiEmbedding[],
   contents: string[],
   bucket: string,
   path: string,
   batchSize = 100,
): Promise<void> => {
   if (embeddings.length !== contents.length) {
      throw new Error("Embeddings and contents length mismatch");
   }

   const objectId = await getObjectId(bucket, path);

   for (let i = 0; i < embeddings.length; i += batchSize) {
      const batchEmbeddings = embeddings.slice(i, i + batchSize);
      const batchContents = contents.slice(i, i + batchSize);

      const rows = batchEmbeddings.map((embedding, j) => {
         if (!embedding.values) {
            throw new Error("Missing embedding values");
         }

         return {
            object_id: objectId,
            content: batchContents[j],
            vector_data: embedding.values,
            created_at: new Date().toISOString(),
         };
      });

      const { error } = await supabase.from("vector_store").insert(rows);
      if (error) throw new Error(`Insert error: ${error.message}`);
   }
};

export const vectorize = async (
   { bucket, path }: VectorizeRequest,
): Promise<void> => {
   const fileType = getFileTypeFromPath(path);
   const blob = await loadDocumentFromStorage(bucket, path);
   const contentChunks = await readFile(fileType, blob);
   const embeddings = await geminiEmbedding(contentChunks);
   await storeEmbeddings(embeddings, contentChunks, bucket, path);
};
