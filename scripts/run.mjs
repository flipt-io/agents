import { parseArgs } from 'node:util';
import { createServer, loadEnv } from 'vite';

// Keep deterministic GitHub IO outside the model. Flue 2's CLI runs a single
// model conversation, so these multi-step jobs use the standalone JS API.
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  allowPositionals: true,
  options: { payload: { type: 'string' } },
});
const name = positionals[0];
if (!['pr-review', 'issue-health'].includes(name) || !values.payload) {
  throw new Error('Usage: node scripts/run.mjs <pr-review|issue-health> --payload <json>');
}
const payload = JSON.parse(values.payload);
// Match the old CLI: process environment takes precedence over .env.
for (const [key, value] of Object.entries(loadEnv('development', process.cwd(), ''))) {
  if (process.env[key] === undefined) process.env[key] = value;
}
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { run } = await server.ssrLoadModule(`/workflows/${name}.ts`);
  console.log(JSON.stringify(await run({ payload, env: process.env })));
} finally {
  await server.close();
}
