import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import process from 'node:process';

// Clerk uses the mockable global fetch in test mode instead of capturing native fetch.
process.env.NODE_ENV = 'test';
process.env.CLERK_TELEMETRY_DISABLED = '1';

declare global {
  namespace Cloudflare {
    interface Env { TEST_MIGRATIONS: D1Migration[] }
  }
}
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
