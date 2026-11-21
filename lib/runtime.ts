import { defineTool, useDataWriter, useTool, type Sandbox } from '@flue/runtime';
import * as v from 'valibot';
import { local } from '@flue/runtime/node';

export type WorkflowInput = {
  payload: unknown;
  env: Record<string, string | undefined>;
};

// Trusted IO is never registered as a model tool.
export interface GitHubIo {
  shell(command: string, options?: Parameters<Sandbox['exec']>[1]): ReturnType<Sandbox['exec']>;
  fs: Pick<Sandbox, 'writeFile'>;
}

export async function githubIo(env: WorkflowInput['env']): Promise<GitHubIo> {
  const sandbox = await local({ env: {
    GH_TOKEN: env.GH_TOKEN ?? env.GITHUB_TOKEN,
    GITHUB_TOKEN: env.GITHUB_TOKEN ?? env.GH_TOKEN,
  } }).createSandbox({ id: crypto.randomUUID() });
  return { shell: (command, options) => sandbox.exec(command, options), fs: sandbox };
}

// Flue 2.3.1 has no useOutput hook. A terminating, schema-validated tool
// publishes the result as a durable data part, independent of assistant prose.
export function useResult<S extends v.GenericSchema<Record<string, unknown>>>(schema: S) {
  const write = useDataWriter('result', { schema });
  useTool(defineTool({
    name: 'submit_result',
    description: 'Submit the final structured skill result and end analysis.',
    input: schema,
    run({ data }) {
      write(data);
      return { output: 'Result accepted.', terminate: true };
    },
  }));
}

export function skillPrompt(name: string, args: unknown): string {
  return `Activate the named skill ${JSON.stringify(name)} with activate_skill, then follow its instructions using these JSON arguments:\n${JSON.stringify(args)}\nSubmit the result using submit_result; do not finish with freeform prose.`;
}
