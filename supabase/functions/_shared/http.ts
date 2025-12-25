import { AppError } from "./errors.ts";
import { AuthenticatedUser, authenticateUser } from "./auth.ts";

export function jsonResponse(
   data: unknown,
   status = 200,
   init?: ResponseInit,
): Response {
   return new Response(JSON.stringify(data), {
      status,
      headers: {
         "Content-Type": "application/json",
         ...(init?.headers ?? {}),
      },
      ...init,
   });
}

export function createJsonHandler<TBody = unknown>(
   handler: (req: Request, body: TBody) => Promise<unknown> | unknown,
): (req: Request) => Promise<Response> {
   return async (req: Request): Promise<Response> => {
      try {
         const body = (await req.json()) as TBody;
         const result = await handler(req, body);

         if (result instanceof Response) {
            return result;
         }

         return jsonResponse(result);
      } catch (err) {
         if (err instanceof AppError) {
            return jsonResponse({ error: err.message }, err.status);
         }
         console.error(err);
         return jsonResponse({ error: "Internal server error" }, 500);
      }
   };
}

export function createAuthenticatedJsonHandler<TBody = unknown>(
   handler: (
      req: Request,
      body: TBody,
      user: AuthenticatedUser,
   ) => Promise<unknown> | unknown,
): (req: Request) => Promise<Response> {
   return async (req: Request): Promise<Response> => {
      try {
         const user = await authenticateUser(req);

         const body = (await req.json()) as TBody;
         const result = await handler(req, body, user);

         if (result instanceof Response) {
            return result;
         }

         return jsonResponse(result);
      } catch (err) {
         if (err instanceof AppError) {
            return jsonResponse({ error: err.message }, err.status);
         }
         console.error(err);
         return jsonResponse({ error: "Internal server error" }, 500);
      }
   };
}
