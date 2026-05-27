import { flue, registerProvider } from '@flue/runtime/app';

// GitHub Models (https://docs.github.com/en/github-models) exposes an
// OpenAI-chat-completions-compatible endpoint. Registering it as a Flue
// provider lets the agent use model ids like `github/openai/gpt-5`,
// authenticated with a GitHub token that has `models: read` — a PAT, or the
// Actions GITHUB_TOKEN with that permission.
//
// This is the default provider (see workflows/pr-review.ts). Registration is a
// no-op without a token, so a `flue run` with REVIEW_MODEL=anthropic/... and an
// ANTHROPIC_API_KEY still works.
const githubModelsToken =
  process.env.GITHUB_MODELS_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (githubModelsToken) {
  registerProvider('github', {
    // pi-ai's OpenAI chat-completions wire protocol; GitHub Models speaks it.
    api: 'openai-completions',
    // pi-ai appends `/chat/completions` to this base.
    baseUrl: 'https://models.github.ai/inference',
    apiKey: githubModelsToken,
    // Default sizing is free-tier-safe: GitHub's free tier caps requests at
    // ~8k input / 4k output regardless of a model's catalog limits, so free
    // low/high-tier models (gpt-4.1, gpt-4o, ...) inherit this. Paid "custom"
    // tier models get their real catalog limits via per-model overrides.
    contextWindow: 8000,
    maxTokens: 4000,
    models: {
      // Paid "custom" tier — 200k context, no 8k free-tier cap.
      'openai/gpt-5-mini': { contextWindow: 200000, maxTokens: 16384 },
      'openai/gpt-5': { contextWindow: 200000, maxTokens: 16384 },
    },
  });
}

// Flue's built-in app (a Hono instance). The provider registration above runs
// first as a module side effect, then Flue serves the agent normally.
export default flue();
