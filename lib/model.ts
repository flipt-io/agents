// Model selection.
//
// There is no default model or default provider in this repo — whoever runs an
// agent chooses both. Each workflow reads its own `*_MODEL` environment
// variable (set locally in `.env`, or in CI from the composite action's `model`
// input) and passes it through `requireModel`, so a missing or malformed value
// fails loudly at startup instead of half-way through a review.
//
// The provider's credentials travel separately, in the process environment
// (`CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, …).

/** Example ids used in the error messages below — one per common provider. */
const EXAMPLES = ['cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6', 'anthropic/claude-sonnet-4-6'];

/**
 * Validate a `<provider>/<model>` specifier from the environment.
 *
 * @param value   raw environment value, e.g. `process.env.REVIEW_MODEL`
 * @param envVar  its name, used in the error message
 */
export function requireModel(value: string | undefined, envVar: string): string {
  const model = value?.trim();

  if (!model) {
    throw new Error(
      `${envVar} is required: this agent has no default model. Set it to a ` +
        `provider-qualified model id (e.g. ${EXAMPLES.join(' or ')}) and provide ` +
        `that provider's credentials in the environment.`,
    );
  }

  // `<provider>/<model>`; the model half may itself contain slashes, as
  // Cloudflare's `@cf/...` ids do.
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(
      `${envVar} must be provider-qualified as "<provider>/<model>" (e.g. ` +
        `${EXAMPLES.join(' or ')}); got "${model}".`,
    );
  }

  return model;
}
