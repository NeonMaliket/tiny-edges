// supabase/functions/_shared/services/storageService.ts

import { supabaseAdmin } from "../config/supabaseClient.ts";
import { AppError } from "../errors.ts";

const BUCKET = "storage";

async function collectFilePaths(prefix: string): Promise<string[]> {
  const allPaths: string[] = [];

  async function walk(path: string): Promise<void> {
    console.log("WALK PATH:", path);

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(path);

    if (error) {
      console.error("LIST ERROR:", error, "AT PATH:", path);
      return;
    }

    console.log("LIST RESULT @", path, ":", data);

    for (const entry of data ?? []) {
      const fullPath = `${path}/${entry.name}`;

      // папка (как у тебя: нет id/created_at/updated_at)
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

// --- delete_user_storage ---

export interface DeleteUserStorageParams {
  userId: string;
}

export async function deleteUserStorage(
  { userId }: DeleteUserStorageParams,
): Promise<void> {
  const rootPrefix = `${userId}`;
  console.log("ROOT PREFIX (USER FOLDER):", rootPrefix);

  const filePaths = await collectFilePaths(rootPrefix);
  console.log("ALL FILE PATHS TO DELETE:", filePaths);

  if (filePaths.length === 0) {
    console.log("NO FILES FOUND UNDER USER FOLDER");
    return;
  }

  const { data: rmData, error: rmErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .remove(filePaths);

  console.log("REMOVE RESULT DATA:", rmData);

  if (rmErr) {
    console.error("REMOVE ERROR:", rmErr);
    throw new AppError("Failed to delete user storage", 500);
  }

  console.log("DELETED FILES FOR USER:", userId, filePaths);
}

// --- delete_chat_storage ---

export interface DeleteChatStorageParams {
  userId: string;
  chatId: string;
}

export async function deleteChatStorage(
  { userId, chatId }: DeleteChatStorageParams,
): Promise<void> {
  const rootPrefix = `${userId}/chats/${chatId}`;
  console.log("ROOT PREFIX:", rootPrefix);

  const filePaths = await collectFilePaths(rootPrefix);
  console.log("ALL FILE PATHS TO DELETE:", filePaths);

  if (filePaths.length === 0) {
    console.log("NO FILES FOUND UNDER CHAT FOLDER");
    return;
  }

  const { data: rmData, error: rmErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .remove(filePaths);

  console.log("REMOVE RESULT DATA:", rmData);

  if (rmErr) {
    console.error("REMOVE ERROR:", rmErr);
    throw new AppError("Failed to delete chat storage", 500);
  }

  console.log("DELETED FILES:", filePaths);
}
