import { createAgent, type FlueContext, type FlueSession, type WorkflowRouteHandler } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';
import {
  applyIssueHealthLabels,
  fetchExistingIssueLabels,
  postIssueHealthComment,
  renderIssueHealthComment,
  type IssueHealthCommentMode,
  type IssueHealthLabelMode,
} from '../lib/issue-health.ts';

// ---------------------------------------------------------------------------
// Global skills
// ---------------------------------------------------------------------------
import issueHealth from '../skills/issue-health/SKILL.md' with { type: 'skill' };

const agent = createAgent((ctx) => ({
  // Run against the checked-out host repo, but do not expose GitHub auth to the
  // model-facing shell tools. Deterministic workflow code passes GitHub auth only
  // to harness-level shell calls that are not available to the model.
  sandbox: local(),
  model: 'github/openai/gpt-4.1',
  thinkingLevel: 'low',
  instructions:
    'For issue-health skill calls, analyze only the supplied issue context. Do not run shell commands, call GitHub APIs, post comments, or apply labels; workflow code handles all GitHub IO deterministically.',
  skills: [issueHealth],
}));

const PayloadSchema = v.object({
  issueNumber: v.number(),
  repo: v.optional(v.string()),
});

const IssueHealthCommentModeSchema = v.picklist(['always', 'needs-improvement', 'off']);
const IssueHealthLabelModeSchema = v.picklist(['existing-only', 'off']);

const IssueLabelSchema = v.object({
  name: v.string(),
});
const IssueSchema = v.object({
  number: v.number(),
  title: v.string(),
  body: v.nullable(v.string()),
  author: v.object({
    login: v.string(),
  }),
  labels: v.array(IssueLabelSchema),
  url: v.string(),
  state: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
});
type Issue = v.InferOutput<typeof IssueSchema>;

const SkillResult = v.object({
  issueType: v.picklist(['bug', 'feature', 'docs', 'question', 'other']),
  verdict: v.picklist(['well_scoped', 'mostly_actionable', 'needs_info', 'not_actionable']),
  score: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
  summary: v.string(),
  missingInfo: v.array(v.string()),
  suggestedLabels: v.array(v.string()),
  redactionWarning: v.nullable(v.string()),
});
type SkillResult = v.InferOutput<typeof SkillResult>;

type Config = {
  agentDir: string;
  targetDir: string;
  localConfigDir: string;
  overrideMode: 'merge' | 'replace';
  model?: string;
  commentMode: IssueHealthCommentMode;
  labelMode: IssueHealthLabelMode;
};

function resolveConfig(env: Record<string, string | undefined>): Config {
  return {
    // Central skills/prompts (this project). '.' for local runs.
    agentDir: env.ISSUE_HEALTH_AGENT_DIR || '.',
    // Checked-out target repo, used as context when actions provide it.
    targetDir: env.ISSUE_HEALTH_TARGET_DIR || '',
    // The target repo's optional `.agents/` overrides; '' when absent.
    localConfigDir: env.ISSUE_HEALTH_TARGET_DIR ? `${env.ISSUE_HEALTH_TARGET_DIR}/.agents` : '',
    overrideMode: env.ISSUE_HEALTH_OVERRIDE_MODE === 'replace' ? 'replace' : 'merge',
    model: env.ISSUE_HEALTH_MODEL || undefined,
    commentMode: parseCommentMode(env.ISSUE_HEALTH_COMMENT_MODE),
    labelMode: parseLabelMode(env.ISSUE_HEALTH_LABEL_MODE),
  };
}

function parseCommentMode(value: string | undefined): IssueHealthCommentMode {
  if (!value) return 'always';
  return v.parse(IssueHealthCommentModeSchema, value);
}

function parseLabelMode(value: string | undefined): IssueHealthLabelMode {
  if (!value) return 'existing-only';
  return v.parse(IssueHealthLabelModeSchema, value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shouldPostComment(mode: IssueHealthCommentMode, result: SkillResult): boolean {
  if (mode === 'off') return false;
  if (mode === 'needs-improvement') return result.verdict === 'needs_info' || result.verdict === 'not_actionable';
  return true;
}

type GitHubIo = Pick<FlueSession, 'shell' | 'fs'>;

async function fetchIssue(session: Pick<FlueSession, 'shell'>, issueNumber: number, repo: string): Promise<Issue> {
  const fields = 'number,title,body,author,labels,url,state,createdAt,updatedAt';
  const { exitCode, stdout, stderr } = await session.shell(
    `gh issue view ${issueNumber} --repo ${shellQuote(repo)} --json ${fields}`,
  );

  if (exitCode !== 0) {
    throw new Error(`Failed to fetch issue ${repo}#${issueNumber}: ${stderr || stdout}`);
  }

  return v.parse(IssueSchema, JSON.parse(stdout));
}

export async function run({ init, payload, env }: FlueContext) {
  const { issueNumber, repo } = v.parse(PayloadSchema, payload);
  const targetRepo = repo ?? env.GITHUB_REPOSITORY;
  if (!targetRepo) throw new Error('issue-health requires payload.repo or GITHUB_REPOSITORY');

  const cfg = resolveConfig(env);
  const harness = await init(agent);
  const session = await harness.session();
  const githubEnv = {
    GH_TOKEN: env.GH_TOKEN ?? env.GITHUB_TOKEN ?? '',
    GITHUB_TOKEN: env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '',
  };
  const github: GitHubIo = {
    shell: (command, options) => harness.shell(command, { ...options, env: { ...githubEnv, ...options?.env } }),
    fs: harness.fs,
  };

  const issue = await fetchIssue(github, issueNumber, targetRepo);
  const existingLabels = await fetchExistingIssueLabels(github, targetRepo);
  const currentLabels = issue.labels.map((label) => label.name);

  const { data } = await session.skill('issue-health', {
    model: cfg.model,
    args: {
      repo: targetRepo,
      issue: {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        author: issue.author.login,
        labels: currentLabels,
        url: issue.url,
        state: issue.state,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      },
      targetRepoLabels: existingLabels,
      agentDir: cfg.agentDir,
      targetDir: cfg.targetDir,
      localConfigDir: cfg.localConfigDir,
      overrideMode: cfg.overrideMode,
    },
    result: SkillResult,
  });

  const commentPosted = shouldPostComment(cfg.commentMode, data)
    ? await postIssueHealthComment(github, issueNumber, targetRepo, renderIssueHealthComment(data))
    : false;

  const labelResult = await applyIssueHealthLabels(github, issueNumber, targetRepo, data, existingLabels, {
    labelMode: cfg.labelMode,
  });

  return {
    issueType: data.issueType,
    verdict: data.verdict,
    score: data.score,
    missingInfo: data.missingInfo,
    labelsApplied: labelResult.applied ? labelResult.labels : [],
    commentPosted,
  };
}

// Internal-only: no public HTTP route. This agent is invoked from CI via
// `flue run issue-health`.
export const route: WorkflowRouteHandler = async (_c, next) => next();
