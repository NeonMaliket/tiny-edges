import { Groq } from "npm:groq-sdk@0.37.0";
import { getEnv } from "./env.ts";

export const groqClient = new Groq({
   apiKey: getEnv("GROQ_API_KEY"),
});
