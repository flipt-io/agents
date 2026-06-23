import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';

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
    // Default sizing is free-tier-safe: on a free account GitHub caps requests
    // at ~8k input / 4k output. Per-model overrides below assume a PAID plan,
    // where those caps lift to production limits.
    contextWindow: 8000,
    maxTokens: 4000,
    models: {
      // Default model — paid plan lifts the 8k cap; sized generously for diffs.
      'openai/gpt-4.1': { contextWindow: 128000, maxTokens: 16384 },
      // Reasoning models (need the responses API / max_completion_tokens).
      'openai/gpt-5-mini': { contextWindow: 200000, maxTokens: 16384 },
      'openai/gpt-5': { contextWindow: 200000, maxTokens: 16384 },
    },
  });
}

// Flue's built-in app (a Hono instance). The provider registration above runs
// first as a module side effect, then Flue serves the agent normally.
export default flue();
