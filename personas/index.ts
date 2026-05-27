// Global subagent personas, registered on the agent so every review can
// delegate focused deep-dives to them. Add a persona: create a module in this
// folder that exports a `defineAgentProfile(...)`, then add it to this array.
import { security } from './security.ts';
import { correctness } from './correctness.ts';

export const personas = [security, correctness];
