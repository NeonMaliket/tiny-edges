// supabase/functions/vectorize/index.ts

// deno-lint-ignore no-unversioned-import
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createJsonHandler } from "../_shared/http.ts";
import {
   vectorize,
   VectorizeRequest,
} from "../_shared/services/vectorizeService.ts";

Deno.serve(
   createJsonHandler<VectorizeRequest>(async (_req, body) => {
      const { bucket, path } = body;

      if (!bucket || !path) {
         return new Response("Missing bucket or path", { status: 400 });
      }

      await vectorize({ bucket, path });

      return new Response("ok", {
         status: 200,
      });
   }),
);
