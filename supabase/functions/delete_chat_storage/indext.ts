import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
async function collectFilePaths(supabase, bucket, prefix) {
   const allPaths = [];
   async function walk(path) {
      console.log("WALK PATH:", path);
      const { data, error } = await supabase.storage.from(bucket).list(path);
      if (error) {
         console.error("LIST ERROR:", error, "AT PATH:", path);
         return;
      }
      console.log("LIST RESULT @", path, ":", data);
      for (const entry of data ?? []) {
         const fullPath = `${path}/${entry.name}`;
         if (!entry.id && !entry.created_at && !entry.updated_at) {
            await walk(fullPath);
         } else {
            allPaths.push(fullPath);
         }
      }
   }
   await walk(prefix);
   return allPaths;
}
serve(async (req) => {
   try {
      const payload = await req.json();
      console.log("PAYLOAD:", payload);
      const old = payload.old_record;
      console.log("OLD_RECORD:", old);
      const user_id = old?.user_id;
      const chat_id = old?.id;
      if (!user_id || !chat_id) {
         console.error("MISSING FIELDS:", {
            user_id,
            chat_id,
         });
         return new Response(null, {
            status: 400,
         });
      }
      const supabase = createClient(
         Deno.env.get("SUPABASE_URL"),
         Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      );
      const bucket = "storage";
      const rootPrefix = `${user_id}/chats/${chat_id}`;
      console.log("ROOT PREFIX:", rootPrefix);
      const filePaths = await collectFilePaths(supabase, bucket, rootPrefix);
      console.log("ALL FILE PATHS TO DELETE:", filePaths);
      if (filePaths.length === 0) {
         console.log("NO FILES FOUND UNDER CHAT FOLDER");
         return new Response(null, {
            status: 200,
         });
      }
      const { data: rmData, error: rmErr } = await supabase.storage.from(bucket)
         .remove(filePaths);
      console.log("REMOVE RESULT DATA:", rmData);
      if (rmErr) {
         console.error("REMOVE ERROR:", rmErr);
         return new Response(null, {
            status: 500,
         });
      }
      console.log("DELETED FILES:", filePaths);
      return new Response(null, {
         status: 200,
      });
   } catch (e) {
      console.error("UNHANDLED ERROR:", e);
      return new Response(null, {
         status: 500,
      });
   }
});
