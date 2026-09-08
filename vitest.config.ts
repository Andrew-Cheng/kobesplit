import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: {
      TEST_MIGRATIONS: await readD1Migrations('./migrations'),
      CLERK_SECRET_KEY: 'sk_test_fixture',
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.fixture.test$').toString('base64')}`,
    } },
  }))],
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['./tests/setup.ts'], restoreMocks: true },
});
