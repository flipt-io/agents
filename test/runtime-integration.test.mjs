import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowModuleServer } from '../scripts/module-server.mjs';
import { init, useModel, useSkill, useSandbox } from '@flue/runtime';
import { start, local } from '@flue/runtime/node';
import * as v from 'valibot';

// Resolve the runtime's own transitive Pi version without adding a dependency.
const pi = await import(new URL('../../../@earendil-works/pi-ai/dist/index.js', import.meta.resolve('@flue/runtime')));

test('real runtime mounts hooks, validates submit_result, and aborts running work', { timeout: 15000 }, async () => {
  const server = await createWorkflowModuleServer();
  // Give asynchronous dev-server bootstrap time to run if the loader ever
  // regresses to loading the project's flue() Vite plugin.
  await new Promise(resolve => setTimeout(resolve, 250));
  let runtime;
  try {
    const { useResult, skillPrompt } = await server.ssrLoadModule('./lib/runtime.ts');
    const schema = v.object({ summary: v.string() });
    const model = { id: 'test', name: 'test', provider: 'fake', api: 'openai-completions', reasoning: false, input: ['text'], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    let calls = 0;
    let stalled = false;
    let resolveStarted;
    const started = new Promise(resolve => { resolveStarted = resolve; });
    let resolveAborted;
    const aborted = new Promise(resolve => { resolveAborted = resolve; });
    function stream(_model, context, options) {
      const events = pi.createAssistantMessageEventStream();
      queueMicrotask(() => {
        if (stalled) {
          resolveStarted();
          options.signal.addEventListener('abort', () => {
            resolveAborted();
            events.push({ type: 'error', reason: 'aborted', error: { role: 'assistant', content: [], api: model.api, provider: 'fake', model: 'test', stopReason: 'aborted', timestamp: Date.now(), usage: usage() } });
            events.end();
          }, { once: true });
          return;
        }
        assert.match(JSON.stringify(context), /submit_result/);
        const content = calls++ === 0
          ? [{ type: 'toolCall', id: 'activate', name: 'activate_skill', arguments: { name: 'example' } }]
          : [{ type: 'toolCall', id: 'submit', name: 'submit_result', arguments: { summary: 'Validated result' } }];
        const message = { role: 'assistant', content, api: model.api, provider: 'fake', model: 'test', stopReason: 'toolUse', timestamp: Date.now(), usage: usage() };
        events.push({ type: 'start', partial: message });
        events.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        events.push({ type: 'toolcall_end', contentIndex: 0, toolCall: content[0], partial: message });
        events.push({ type: 'done', reason: 'toolUse', message });
        events.end();
      });
      return events;
    }
    const provider = { id: 'fake', name: 'Fake', auth: { apiKey: { resolve: () => ({ auth: { apiKey: 'test' } }) } }, getModels: () => [model], stream, streamSimple: stream };
    function TestAgent() {
      useModel('fake/test');
      useSandbox(local());
      useSkill({ name: 'example', description: 'Example skill', instructions: 'Return a summary using submit_result.' });
      useResult(schema);
    }
    runtime = await start({ agents: [TestAgent], providers: [provider], env: {} });
    const handle = init(TestAgent);
    const receipt = await handle.dispatch(skillPrompt('example', {}));
    const reply = await handle.read(receipt);
    assert.deepEqual(reply.data.result, [{ summary: 'Validated result' }]);
    assert.equal(calls, 2);
    stalled = true;
    const pending = await handle.dispatch('Wait indefinitely');
    await started;
    const read = handle.read(pending);
    // Settlement can race the provider's own aborted terminal response. Both
    // outcomes are legal here; the assertion below requires real cancellation.
    const settled = read.catch(error => assert.equal(error.outcome, 'aborted'));
    await handle.abort();
    await settled;
    await aborted;
  } finally {
    await runtime?.stop();
    await server.close();
  }
});

function usage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}
