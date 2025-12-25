import "@supabase/functions-js/edge-runtime.d.ts";
import { requireAuth } from "../_shared/auth.ts";
import {
  vectorize,
  VectorizeRequest,
} from "../_shared/services/vectorizeService.ts";

Deno.serve(
  requireAuth<VectorizeRequest>(async (_req, body, _user) => {
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
