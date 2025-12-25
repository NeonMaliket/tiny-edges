import { createClient } from "jsr:@supabase/supabase-js@2.89.0";
import { AppError } from "./errors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

export interface AuthenticatedUser {
   id: string;
   email?: string;
   user_metadata?: Record<string, unknown>;
   token: string;
}

export function extractBearerToken(request: Request): string | null {
   const authHeader = request.headers.get("Authorization");
   if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
   }
   return authHeader.substring(7);
}

export async function authenticateUser(
   request: Request,
): Promise<AuthenticatedUser> {
   const token = extractBearerToken(request);

   if (!token) {
      throw new AppError(
         "Authentication required. Please provide a valid Bearer token.",
         401,
      );
   }

   const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
         headers: { Authorization: `Bearer ${token}` },
      },
   });

   const { data: { user }, error } = await supabase.auth.getUser(token);

   if (error || !user) {
      throw new AppError("Invalid or expired token", 401);
   }

   return {
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata,
      token,
   };
}

export function requireAuth<TBody = unknown>(
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

         return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
               "Content-Type": "application/json",
            },
         });
      } catch (err) {
         if (err instanceof AppError) {
            return new Response(
               JSON.stringify({ error: err.message }),
               {
                  status: err.status,
                  headers: {
                     "Content-Type": "application/json",
                  },
               },
            );
         }

         console.error("Unexpected error:", err);
         return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
               status: 500,
               headers: {
                  "Content-Type": "application/json",
               },
            },
         );
      }
   };
}

export function requireAuthWithoutBody(
   handler: (
      req: Request,
      user: AuthenticatedUser,
   ) => Promise<unknown> | unknown,
): (req: Request) => Promise<Response> {
   return async (req: Request): Promise<Response> => {
      try {
         const user = await authenticateUser(req);
         const result = await handler(req, user);

         if (result instanceof Response) {
            return result;
         }

         return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
               "Content-Type": "application/json",
            },
         });
      } catch (err) {
         if (err instanceof AppError) {
            return new Response(
               JSON.stringify({ error: err.message }),
               {
                  status: err.status,
                  headers: {
                     "Content-Type": "application/json",
                  },
               },
            );
         }

         console.error("Unexpected error:", err);
         return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
               status: 500,
               headers: {
                  "Content-Type": "application/json",
               },
            },
         );
      }
   };
}
