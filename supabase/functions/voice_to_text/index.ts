import "jsr:@supabase/functions-js/edge-runtime.d.ts";
console.info("server started");
Deno.serve(async (req) => {
   const { voicePath } = await req.json();
   const data = {
      transcript: `Hello how are you.`,
   };
   return new Response(JSON.stringify(data), {
      headers: {
         "Content-Type": "application/json",
         "Connection": "keep-alive",
      },
   });
});
