import { defineConfig } from '@flue/runtime/config';

export default defineConfig({
  // Default build/run target. CLI `--target` flags still override this.
  target: 'node',
});
