import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ApiError } from "../../lib/errors.ts";
import { systemPrompt, userPrompt } from "./prompt.ts";
import { analysisSchema, type AnalysisInput } from "./schema.ts";

export type AiProvider = {
  name: string;
  model: string;
  // Returns the model's raw text. Validation belongs to the caller.
  complete(input: AnalysisInput): Promise<{ text: string; model: string }>;
};
const settings = z.object({
  SENTINELSCAN_AI_PROVIDER: z.enum(["", "anthropic"]).default(""),
  ANTHROPIC_API_KEY: z.string().trim().default(""),
  SENTINELSCAN_AI_MODEL: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{0,63}$/)
    .default("claude-opus-5-5"),
  SENTINELSCAN_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
});
export type AiConfiguration =
  | { enabled: true; provider: AiProvider }
  | { enabled: false; reason: "AI_DISABLED" | "AI_MISSING_KEY" | "AI_INVALID_CONFIGURATION" };

export function createAnthropicProvider(
  key: string,
  model: string,
  timeoutMs: number,
  transport?: typeof fetch,
): AiProvider {
  // Everything is explicit, so ambient credentials, profiles or base URLs are never used.
  const client = new Anthropic({
    apiKey: key,
    baseURL: "https://api.anthropic.com",
    timeout: timeoutMs,
    maxRetries: 1,
    logLevel: "off",
    ...(transport ? { fetch: transport } : {}),
  });
  return {
    name: "anthropic",
    model,
    async complete(input) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          // Security text can trip safety classifiers. The server picks a fallback model.
          fallbacks: "default",
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt(input) }],
          output_config: {
            effort: "medium",
            format: {
              type: "json_schema",
              schema: zodOutputFormat(analysisSchema).schema,
            },
          },
        });
        if (response.stop_reason === "refusal") throw new ApiError(502, "AI_REFUSED");
        if (response.stop_reason === "max_tokens") throw new ApiError(502, "AI_TRUNCATED");
        const text = response.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
        return { text, model: response.model };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ApiError(504, "AI_TIMEOUT");
        if (error instanceof Anthropic.RateLimitError) throw new ApiError(429, "AI_RATE_LIMITED");
        if (
          error instanceof Anthropic.AuthenticationError ||
          error instanceof Anthropic.PermissionDeniedError
        )
          throw new ApiError(502, "AI_INVALID_CREDENTIALS");
        if (error instanceof Anthropic.APIConnectionError) throw new ApiError(503, "AI_UNAVAILABLE");
        // Provider messages can quote the request, so they are never surfaced.
        throw new ApiError(502, "AI_PROVIDER_ERROR");
      }
    },
  };
}
export function configuredAi(env: NodeJS.ProcessEnv = process.env): AiConfiguration {
  const parsed = settings.safeParse(env);
  if (!parsed.success) return { enabled: false, reason: "AI_INVALID_CONFIGURATION" };
  const value = parsed.data;
  if (!value.SENTINELSCAN_AI_PROVIDER) return { enabled: false, reason: "AI_DISABLED" };
  if (!value.ANTHROPIC_API_KEY) return { enabled: false, reason: "AI_MISSING_KEY" };
  return {
    enabled: true,
    provider: createAnthropicProvider(
      value.ANTHROPIC_API_KEY,
      value.SENTINELSCAN_AI_MODEL,
      value.SENTINELSCAN_AI_TIMEOUT_MS,
    ),
  };
}
