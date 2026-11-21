import { createMcpConnection, init, useModel, useSandbox, useSkill, useSubagent, useTool, type McpConnection } from '@flue/runtime';
import { start, local } from '@flue/runtime/node';
import { githubIo, skillPrompt, useResult, type WorkflowInput } from '../lib/runtime.ts';
import path from 'node:path';
import * as v from 'valibot';
import { requireModel } from '../lib/model.ts';
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
// a `useSkill` call. (Global prompts work differently — see below — and need
// no code change at all.)
// ---------------------------------------------------------------------------
import codeReview from '../skills/code-review/SKILL.md';

// Global subagent personas — see ./personas. Registering them here makes them
// available for the reviewer to delegate focused deep-dives to, on every PR.
import { personas } from '../personas/index.ts';

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
// sensible fallbacks for local runs.
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


export async function run({ payload, env }: WorkflowInput) {
  const model = requireModel(env.REVIEW_MODEL, 'REVIEW_MODEL');
  const { prNumber, repo } = v.parse(PayloadSchema, payload);
  const targetRepo = repo ?? env.GITHUB_REPOSITORY;
  const cfg = resolveConfig(env);

  // Give the reviewer the Flipt docs MCP (no auth) so it can ground reviews in
  // the docs (tools surface as `mcp__flipt-docs__*`). Best-effort and
  // env-overridable: set REVIEW_DOCS_MCP_URL='' to disable, or to another URL.
  const docsMcpUrl = env.REVIEW_DOCS_MCP_URL ?? 'https://docs.flipt.io/mcp';
  let docs: McpConnection | undefined;
  if (docsMcpUrl) {
    try {
      docs = await createMcpConnection({ name: 'flipt-docs', url: docsMcpUrl });
    } catch {
      console.error(`Docs MCP unavailable (${docsMcpUrl}); reviewing without it.`);
    }
  }

  function ReviewAgent() {
    useModel(model, { thinkingLevel: 'low' });
    useSandbox(local({ env: {
      GH_TOKEN: env.GH_TOKEN ?? env.GITHUB_TOKEN,
      GITHUB_TOKEN: env.GITHUB_TOKEN ?? env.GH_TOKEN,
    } }));
    useResult(SkillResult);
    useSkill(codeReview);
    for (const persona of personas) useSubagent(persona);
    for (const tool of docs?.tools ?? []) useTool(tool);
    return 'Analyze the PR and return findings. Do not post a review; trusted workflow code handles posting.';
  }
  let runtime: Awaited<ReturnType<typeof start>> | undefined;
  try {
    runtime = await start({ agents: [ReviewAgent], env });
    const handle = init(ReviewAgent);
    const github = await githubIo(env);

    const stats: ReviewStats = { changedFiles: 999, additions: 1_000, deletions: 0 };
    if (targetRepo) {
      try {
        const result = await github.shell(reviewStatsCommand(prNumber, targetRepo), {
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
      const receipt = await handle.dispatch(skillPrompt('code-review', {
          prNumber,
          repo: targetRepo,
          agentDir: cfg.agentDir,
          targetDir: cfg.targetDir,
          localConfigDir: cfg.localConfigDir,
          overrideMode: cfg.overrideMode,
          reviewBudget,
        }));
      try {
        const reply = await handle.read(receipt, { signal: reviewSignal });
        data = v.parse(SkillResult, reply.data.result?.at(-1));
      } catch (error) {
        if (reviewSignal.aborted) await handle.abort();
        throw error;
      }
    } catch (error) {
      if (!reviewSignal.aborted) throw error;
      data = timeoutReviewResult(reviewBudget.timeoutMs);
    }

    // Post deterministically from the structured result — the model doesn't post.
    const posted = targetRepo ? await postReview(github, prNumber, targetRepo, renderReview(data)) : false;
    if (!posted) console.error(`Failed to post review to ${targetRepo}#${prNumber}`);

    return { ...data, posted };
  } finally {
    try { await runtime?.stop(); } finally { await docs?.close(); }
  }
}
