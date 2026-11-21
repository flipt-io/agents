import { Hono } from 'hono';

// Both agents are CI-only: deliberately expose no HTTP agent routes.
export default new Hono();
