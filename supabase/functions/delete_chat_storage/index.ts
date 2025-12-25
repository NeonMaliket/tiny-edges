import "@supabase/functions-js/edge-runtime.d.ts";
import { requireAuth } from "../_shared/auth.ts";
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
  requireAuth<DeleteChatStoragePayload>(async (_req, body, user) => {
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

    if (userId !== user.id) {
      throw new AppError(
        "Unauthorized: Cannot delete storage for other users",
        403,
      );
    }

    const params: DeleteChatStorageParams = { userId, chatId };
    await deleteChatStorage(params);

    return { status: "ok" };
  }),
);
