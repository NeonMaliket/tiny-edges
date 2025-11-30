import { ApiVersion } from "./request.ts";
export type NumId = {
   id: number;
};
export type Role = "user" | "assistant" | "system";
export type MessageType = "text" | "voice";
export type AiOptions = {
   top_k: number;
   top_p: number;
   temperature: number;
   repeat_penalty: number;
   max_tokens: number;
};

export type ChatSettings = {
   ai_options: AiOptions;
   is_rag_enabled: boolean;
};

export type MessageContent = {
   text?: string;
   src?: string;
};

export type SavedMessage = Message & NumId;

export type Message = {
   created_at?: Date;
   content: MessageContent;
   message_type: MessageType;
   author: Role;
   chat_id: number;
};

export type AiRequest = {
   api_verson: ApiVersion;
   chat_settings: ChatSettings;
   message: Message;
   model: string;
};
