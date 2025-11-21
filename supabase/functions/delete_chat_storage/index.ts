// supabase/functions/delete_chat_storage/index.ts

// deno-lint-ignore no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createJsonHandler } from "../_shared/http.ts";
import {
   deleteChatStorage,
   DeleteChatStorageParams,
} from "../_shared/services/storageService.ts";
import { AppError } from "../_shared/errors.ts";

interface DeleteChatStoragePayload {
   old_record?: {
      user_id?: string;
      id?: string;
   };
}

Deno.serve(
   createJsonHandler<DeleteChatStoragePayload>(async (_req, body) => {
      console.log("PAYLOAD:", body);

      const old = body.old_record;
      console.log("OLD_RECORD:", old);

      const userId = old?.user_id;
      const chatId = old?.id;

      if (!userId || !chatId) {
         console.error("MISSING FIELDS:", {
            user_id: userId,
            chat_id: chatId,
         });
         throw new AppError("Missing user_id or chat_id in old_record", 400);
      }

      const params: DeleteChatStorageParams = { userId, chatId };
      await deleteChatStorage(params);

      return { status: "ok" };
   }),
);
