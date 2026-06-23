import {
  connectMcpServer,
  createAgent,
  type FlueContext,
  type McpServerConnection,
  type WorkflowRouteHandler,
} from '@flue/runtime';
import { local } from '@flue/runtime/node';
import path from 'node:path';
import * as v from 'valibot';
import { postReview, renderReview } from '../lib/review-comments.ts';
import {
  parseReviewStats,
  resolveReviewBudget,
  reviewStatsCommand,
  timeoutReviewResult,
  type ReviewStats,
} from '../lib/review-timeout.ts';

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

const agent = createAgent((ctx) => ({
  // `local()` runs against the host filesystem + $PATH (the checked-out repo
  // plus `gh`, `git`, etc.), and auto-discovers AGENTS.md + skills from the
  // project root. By default it only forwards shell-essential env vars to the
  // agent's shell, so expose the GitHub token explicitly — otherwise the `gh`
  // CLI the reviewer shells out to can't read the diff or post the review.
  sandbox: local({
    // The reviewer shells out to `gh` to read the PR diff; expose the token so
    // it's authenticated. (Posting the review is done deterministically by the
    // workflow below, not by the model.)
    env: {
      GH_TOKEN: ctx.env.GH_TOKEN ?? ctx.env.GITHUB_TOKEN,
      GITHUB_TOKEN: ctx.env.GITHUB_TOKEN ?? ctx.env.GH_TOKEN,
    },
  }),
  // GitHub Models default (registered in app.ts). gpt-4.1 accepts the standard
  // chat-completions params and, on a paid plan, lifts the free 8k-token cap to
  // production limits — enough for real reviews. (The gpt-5 family is a
  // reasoning model that needs max_completion_tokens via the responses API, so
  // it isn't the default here.) Override per run with REVIEW_MODEL.
  model: 'github/openai/gpt-4.1',
  // Reasoning effort. Flue defaults to "medium"; reasoning models (Kimi K2.6,
  // the gpt-5 family) map this to their reasoning budget. A PR review is a
  // bounded, well-specified task — the skill spells out exactly what to do — so
  // "low" keeps the model decisive instead of spending minutes deliberating,
  // which is where the runtime and token cost balloon. Non-reasoning models
  // (the gpt-4.1 default) ignore it. Bump back up if review quality regresses.
  thinkingLevel: 'low',
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

function resolveLocalConfigDir(targetDir: string | undefined, localConfigDir: string | undefined): string {
  if (!targetDir) return '';

  const configuredDir = (localConfigDir?.trim() || '.agents').replace(/^\.\//, '').replace(/^[/\\]+/, '');

  return path.join(targetDir, configuredDir);
}

// Resolve where config lives, from env set by the GitHub Action. All have
// sensible fallbacks so a bare `flue run pr-review` still works locally.
function resolveConfig(env: Record<string, string | undefined>) {
  return {
    // Central skills/prompts (this project). '.' for local runs.
    agentDir: env.REVIEW_AGENT_DIR || '.',
    // The checked-out repo under review (its source + its own AGENTS.md/README).
    targetDir: env.REVIEW_TARGET_DIR || '',
    // The under-review repo's optional local overrides; defaults to `.agents`.
    localConfigDir: resolveLocalConfigDir(env.REVIEW_TARGET_DIR, env.REVIEW_LOCAL_CONFIG_DIR),
    // How local overrides combine with central defaults.
    overrideMode: env.REVIEW_OVERRIDE_MODE === 'replace' ? 'replace' : 'merge',
    // Optional per-run model override (empty string -> use agent default).
    model: env.REVIEW_MODEL || undefined,
  };
}

// What the model returns. It only *analyzes* — it does not post. The workflow
// posts deterministically from this (don't trust the LLM to run gh + self-report).
const Finding = v.object({
  file: v.string(),
  line: v.optional(v.number()),
  severity: v.picklist(['critical', 'major', 'minor', 'nit']),
  comment: v.string(),
});
const SkillResult = v.object({
  verdict: v.picklist(['approve', 'comment', 'request_changes']),
  summary: v.string(),
  findings: v.array(Finding),
});
type SkillResult = v.InferOutput<typeof SkillResult>;


export async function run({ init, payload, env }: FlueContext) {
  const { prNumber, repo } = v.parse(PayloadSchema, payload);
  const targetRepo = repo ?? env.GITHUB_REPOSITORY;
  const cfg = resolveConfig(env);

  // Give the reviewer the Flipt docs MCP (no auth) so it can ground reviews in
  // the docs (tools surface as `mcp__flipt-docs__*`). Best-effort and
  // env-overridable: set REVIEW_DOCS_MCP_URL='' to disable, or to another URL.
  const docsMcpUrl = env.REVIEW_DOCS_MCP_URL ?? 'https://docs.flipt.io/mcp';
  let docs: McpServerConnection | undefined;
  if (docsMcpUrl) {
    try {
      docs = await connectMcpServer('flipt-docs', { url: docsMcpUrl });
    } catch {
      console.error(`Docs MCP unavailable (${docsMcpUrl}); reviewing without it.`);
    }
  }

  try {
    const harness = await init(agent, { tools: docs?.tools ?? [] });
    const session = await harness.session();

    const stats: ReviewStats = { changedFiles: 999, additions: 1_000, deletions: 0 };
    if (targetRepo) {
      try {
        const result = await harness.shell(reviewStatsCommand(prNumber, targetRepo), {
          signal: AbortSignal.timeout(30_000),
        });
        if (result.exitCode === 0) {
          Object.assign(stats, parseReviewStats(result.stdout));
        } else {
          console.error(`Failed to fetch PR stats for ${targetRepo}#${prNumber}; using conservative review budget.`);
        }
      } catch {
        console.error(`Timed out fetching PR stats for ${targetRepo}#${prNumber}; using conservative review budget.`);
      }
    }
    const reviewBudget = resolveReviewBudget(stats, env);

    // Activate the global review skill. It layers the central skills/prompts in
    // `agentDir` with any per-repo overrides in `localConfigDir` (per
    // `overrideMode`), fetches the diff with `gh`, and returns its findings.
    // REVIEW_TIMEOUT_MS overrides the tier-derived hard wall-clock kill switch.
    const reviewSignal = AbortSignal.timeout(reviewBudget.timeoutMs);
    let data: SkillResult;

    try {
      ({ data } = await session.skill('code-review', {
        model: cfg.model,
        signal: reviewSignal,
        args: {
          prNumber,
          repo: targetRepo,
          agentDir: cfg.agentDir,
          targetDir: cfg.targetDir,
          localConfigDir: cfg.localConfigDir,
          overrideMode: cfg.overrideMode,
          reviewBudget,
        },
        result: SkillResult,
      }));
    } catch (error) {
      if (!reviewSignal.aborted) throw error;
      data = timeoutReviewResult(reviewBudget.timeoutMs);
    }

    // Post deterministically from the structured result — the model doesn't post.
    const posted = targetRepo ? await postReview(session, prNumber, targetRepo, renderReview(data)) : false;
    if (!posted) console.error(`Failed to post review to ${targetRepo}#${prNumber}`);

    return { ...data, posted };
  } finally {
    await docs?.close();
  }
}

// Internal-only: no public HTTP route. This agent is invoked from CI via
// `flue run pr-review`. Delete this export to expose it over HTTP instead.
export const route: WorkflowRouteHandler = async (_c, next) => next();
