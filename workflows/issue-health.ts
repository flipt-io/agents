import { init, useModel, useSandbox, useSkill } from '@flue/runtime';
import { start, local } from '@flue/runtime/node';
import path from 'node:path';
import * as v from 'valibot';
import { githubIo, skillPrompt, useResult, type GitHubIo, type WorkflowInput } from '../lib/runtime.ts';
import { requireModel } from '../lib/model.ts';
import {
  ISSUE_HEALTH_ISSUE_TYPES,
  ISSUE_HEALTH_VERDICTS,
  applyIssueHealthLabels,
  fetchExistingIssueLabels,
  postIssueHealthComment,
  renderIssueHealthComment,
  resolveIssueHealthConfig,
  shouldPostIssueHealthComment,
  type IssueHealthCommentMode,
  type IssueHealthLabelMode,
} from '../lib/issue-health.ts';

// ---------------------------------------------------------------------------
// Global skills
// ---------------------------------------------------------------------------
import issueHealth from '../skills/issue-health/SKILL.md';

const PayloadSchema = v.object({
  issueNumber: v.number(),
  repo: v.optional(v.string()),
});

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
  issueType: v.picklist(ISSUE_HEALTH_ISSUE_TYPES),
  verdict: v.picklist(ISSUE_HEALTH_VERDICTS),
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
  commentMode: IssueHealthCommentMode;
  labelMode: IssueHealthLabelMode;
};

function resolveLocalConfigDir(targetDir: string | undefined, localConfigDir: string | undefined): string {
  if (!targetDir) return '';

  const configuredDir = (localConfigDir?.trim() || '.agents').replace(/^\.\//, '').replace(/^[/\\]+/, '');

  return path.join(targetDir, configuredDir);
}

function resolveConfig(env: Record<string, string | undefined>): Config {
  const issueHealthConfig = resolveIssueHealthConfig(env);

  return {
    // Central skills/prompts (this project). '.' for local runs.
    agentDir: env.ISSUE_HEALTH_AGENT_DIR || '.',
    // Checked-out target repo, used as context when actions provide it.
    targetDir: env.ISSUE_HEALTH_TARGET_DIR || '',
    // The target repo's optional local overrides; defaults to `.agents`.
    localConfigDir: resolveLocalConfigDir(env.ISSUE_HEALTH_TARGET_DIR, env.ISSUE_HEALTH_LOCAL_CONFIG_DIR),
    overrideMode: env.ISSUE_HEALTH_OVERRIDE_MODE === 'replace' ? 'replace' : 'merge',
    ...issueHealthConfig,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function fetchIssue(session: Pick<GitHubIo, 'shell'>, issueNumber: number, repo: string): Promise<Issue> {
  const fields = 'number,title,body,author,labels,url,state,createdAt,updatedAt';
  const { exitCode, stdout, stderr } = await session.shell(
    `gh issue view ${issueNumber} --repo ${shellQuote(repo)} --json ${fields}`,
  );

  if (exitCode !== 0) {
    throw new Error(`Failed to fetch issue ${repo}#${issueNumber}: ${stderr || stdout}`);
  }

  return v.parse(IssueSchema, JSON.parse(stdout));
}

export async function run({ payload, env }: WorkflowInput) {
  const model = requireModel(env.ISSUE_HEALTH_MODEL, 'ISSUE_HEALTH_MODEL');
  const { issueNumber, repo } = v.parse(PayloadSchema, payload);
  const targetRepo = repo ?? env.GITHUB_REPOSITORY;
  if (!targetRepo) throw new Error('issue-health requires payload.repo or GITHUB_REPOSITORY');

  const cfg = resolveConfig(env);
  function IssueHealthAgent() {
    useModel(model, { thinkingLevel: 'low' });
    useSandbox(local());
    useResult(SkillResult);
    useSkill(issueHealth);
    return 'Analyze only supplied issue context. Do not run shell commands, call GitHub APIs, post comments, or apply labels; trusted workflow code handles GitHub IO.';
  }
  const github = await githubIo(env);
  const issue = await fetchIssue(github, issueNumber, targetRepo);
  const existingLabels = await fetchExistingIssueLabels(github, targetRepo);
  const currentLabels = issue.labels.map((label) => label.name);

  const runtime = await start({ agents: [IssueHealthAgent], env });
  try {
    const handle = init(IssueHealthAgent);
    const receipt = await handle.dispatch(skillPrompt('issue-health', {
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
    }));
    const reply = await handle.read(receipt);
    const data = v.parse(SkillResult, reply.data.result?.at(-1));

    const commentPosted = shouldPostIssueHealthComment(cfg.commentMode, data)
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
  } finally {
    await runtime.stop();
  }
}
