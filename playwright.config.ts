import { defineConfig } from '@playwright/test'

/**
 * Minimal responsive-QA config. The app requires an authenticated Supabase
 * session for most routes, so this suite only covers the pre-login shell
 * (the one screen reachable without real credentials) at the breakpoints
 * from the UX briefing. Screenshots are written outside the repo (gitignored)
 * — never commit real customer data or auth state.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    timeout: 30000,
  },
})
