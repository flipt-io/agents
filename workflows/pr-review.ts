import { createAgent, type FlueContext, type WorkflowRouteHandler } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';

// ---------------------------------------------------------------------------
// Global skills
//
// Skills registered here apply to EVERY pull request this agent reviews — they
// are part of the agent definition, not the per-PR payload. To add another
// global skill: drop a `skills/<name>/SKILL.md`, import it below, and add it to
// the `skills` array. (Global prompts work differently — see below — and need
// no code change at all.)
// ---------------------------------------------------------------------------
import codeReview from '../skills/code-review/SKILL.md' with { type: 'skill' };

// Global subagent personas — see ./personas. Registering them here makes them
// available for the reviewer to delegate focused deep-dives to, on every PR.
import { personas } from '../personas/index.ts';

const agent = createAgent(() => ({
  // `local()` runs against the host filesystem + $PATH. In CI that is the
  // checked-out repo plus `gh`, `git`, etc. Flue auto-discovers AGENTS.md and
  // the skills in this project from the project root.
  sandbox: local(),
  // Free GitHub Models default (registered in app.ts). gpt-4.1 is the strongest
  // free-tier coding model. Override per run with REVIEW_MODEL, e.g.
  // REVIEW_MODEL=github/openai/gpt-5 or anthropic/claude-sonnet-4-6.
  model: 'github/openai/gpt-4.1',
  // Global skills — applied to every PR.
  skills: [codeReview],
  // Global personas — focused subagents the review can delegate to.
  subagents: personas,
}));

// What the caller sends per invocation: just which PR to review.
const PayloadSchema = v.object({
  // The pull/merge request number to review.
  prNumber: v.number(),
  // owner/repo of the PR. Defaults to $GITHUB_REPOSITORY (set by Actions).
  repo: v.optional(v.string()),
});

// Resolve where config lives, from env set by the GitHub Action. All have
// sensible fallbacks so a bare `flue run pr-review` still works locally.
function resolveConfig(env: Record<string, string | undefined>) {
  return {
    // Central skills/prompts (this project). '.' for local runs.
    agentDir: env.REVIEW_AGENT_DIR || '.',
    // The checked-out repo under review (its source + its own AGENTS.md/README).
    targetDir: env.REVIEW_TARGET_DIR || '',
    // The under-review repo's optional `.flue/` overrides; '' when absent.
    localConfigDir: env.REVIEW_TARGET_DIR ? `${env.REVIEW_TARGET_DIR}/.flue` : '',
    // How local overrides combine with central defaults.
    overrideMode: env.REVIEW_OVERRIDE_MODE === 'replace' ? 'replace' : 'merge',
    // Optional per-run model override (empty string -> use agent default).
    model: env.REVIEW_MODEL || undefined,
  };
}

// The structured verdict the agent must return, so callers/CI can branch on it.
const ReviewResult = v.object({
  verdict: v.picklist(['approve', 'comment', 'request_changes']),
  summary: v.string(),
  findings: v.array(
    v.object({
      file: v.string(),
      line: v.optional(v.number()),
      severity: v.picklist(['critical', 'major', 'minor', 'nit']),
      comment: v.string(),
    }),
  ),
  // True once the review has been posted to the PR via `gh`.
  posted: v.boolean(),
});

export async function run({ init, payload, env }: FlueContext) {
  const { prNumber, repo } = v.parse(PayloadSchema, payload);
  const targetRepo = repo ?? env.GITHUB_REPOSITORY;
  const cfg = resolveConfig(env);

  const harness = await init(agent);
  const session = await harness.session();

  // Activate the global review skill. It layers the central skills/prompts in
  // `agentDir` with any per-repo overrides in `localConfigDir` (per
  // `overrideMode`), fetches the diff with `gh`, reviews, and posts the result.
  const { data } = await session.skill('code-review', {
    model: cfg.model,
    args: {
      prNumber,
      repo: targetRepo,
      agentDir: cfg.agentDir,
      targetDir: cfg.targetDir,
      localConfigDir: cfg.localConfigDir,
      overrideMode: cfg.overrideMode,
    },
    result: ReviewResult,
  });

  return data;
}

// Internal-only: no public HTTP route. This agent is invoked from CI via
// `flue run pr-review`. Delete this export to expose it over HTTP instead.
export const route: WorkflowRouteHandler = async (_c, next) => next();
