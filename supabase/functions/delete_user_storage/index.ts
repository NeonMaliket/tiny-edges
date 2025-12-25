import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { requireAuth } from "../_shared/auth.ts";
import {
  deleteUserStorage,
  DeleteUserStorageParams,
} from "../_shared/services/storageService.ts";
import { AppError } from "../_shared/errors.ts";

interface DeleteUserStoragePayload {
  old_record?: { id?: string };
}

Deno.serve(
  requireAuth<DeleteUserStoragePayload>(async (_req, body, user) => {
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

    if (userId !== user.id) {
      throw new AppError(
        "Unauthorized: Cannot delete storage for other users",
        403,
      );
    }

    const params: DeleteUserStorageParams = { userId };
    await deleteUserStorage(params);

    return { status: "ok" };
  }),
);
