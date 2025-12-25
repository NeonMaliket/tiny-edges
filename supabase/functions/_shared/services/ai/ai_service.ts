import { AiRequest } from "../../types/ai.ts";
import { ApiVersion } from "../../types/request.ts";
import { aiServiceV1 } from "./v1.ts";
import { AuthenticatedUser } from "../../auth.ts";

type Handler = (
   request: AiRequest,
   user: AuthenticatedUser,
) => Promise<Response>;

export const handleAiRequest = async (
   request: AiRequest,
   user: AuthenticatedUser,
): Promise<Response> => {
   const strategy: Partial<Record<ApiVersion, Handler>> = {
      v1: aiServiceV1,
   };
   const service = strategy[request.api_verson];

   if (!service) {
      return new Response(
         JSON.stringify({ error: "Unsupported AI service version" }),
         { status: 400, headers: { "Content-Type": "application/json" } },
      );
   }

   try {
      return await service(request, user);
   } catch (error) {
      console.error("Error handling AI request:", error);
      return new Response(
         JSON.stringify({ error: "Internal server error" }),
         { status: 500, headers: { "Content-Type": "application/json" } },
      );
   }
};
