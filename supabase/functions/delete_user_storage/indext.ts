// supabase/functions/delete_user_storage/index.ts

// deno-lint-ignore no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createJsonHandler } from "../_shared/http.ts";
import {
  deleteUserStorage,
  DeleteUserStorageParams,
} from "../_shared/services/storageService.ts";
import { AppError } from "../_shared/errors.ts";

interface DeleteUserStoragePayload {
  old_record?: { id?: string };
}

Deno.serve(
  createJsonHandler<DeleteUserStoragePayload>(async (_req, body) => {
    console.log("PAYLOAD:", body);

    const old = body.old_record;
    console.log("OLD_RECORD:", old);

    const userId = old?.id;

    if (!userId) {
      console.error("MISSING USER_ID:", {
        userId,
        payload: body,
      });
      throw new AppError("Missing user_id in old_record", 400);
    }

    const params: DeleteUserStorageParams = { userId };
    await deleteUserStorage(params);

    // тело особо не важно для триггера
    return { status: "ok" };
  }),
);
