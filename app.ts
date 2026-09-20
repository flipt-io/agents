import { flue } from '@flue/runtime/routing';

// Runtime app entry.
//
// No model provider is registered here and no provider is built in as a
// default: every agent in this repo requires the implementer to pick a
// provider-qualified model (see lib/model.ts) and supply that provider's
// credentials through the environment. Flue resolves the common providers —
// `cloudflare-workers-ai/*`, `anthropic/*`, `openai/*`, … — through pi-ai's
// built-in catalog, so nothing needs registering for those.
//
// To add a provider pi-ai doesn't know about, import `registerProvider` from
// '@flue/runtime' and register it here, before the export below; the
// registration runs as a module side effect, ahead of Flue serving the agent.

// Flue's built-in app (a Hono instance).
export default flue();
