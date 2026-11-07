import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // software-rendered WebGL is heavy: a couple of browsers at a time keeps timings stable
  timeout: 90_000,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'off',
    launchOptions: {
      // software WebGL so the 3D view renders in headless CI
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
