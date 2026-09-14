import { defineConfig, devices } from '@playwright/test';

/**
 * The suite drives a production build, not the dev server: the things most
 * likely to break in this app — WebGL context setup, chunk loading, exporter
 * output — behave differently once Vite has bundled and minified them.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // CI runners have no GPU, so WebGL needs a software rasteriser.
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required',
      ],
      // Honour a preinstalled browser when the environment provides one
      // (sandboxes and some CI images ship Chromium at a fixed path);
      // otherwise Playwright uses the revision it downloaded itself.
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    },
  },

  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 14 Pro'], browserName: 'chromium' },
    },
  ],

  webServer: {
    // Explicitly blank the backend vars so the suite is deterministic: a
    // developer with a .env.local pointing at a real Supabase project would
    // otherwise get a signed-out paywall where the tests expect a download
    // button, and CI (which has no .env.local) would disagree with them.
    command:
      'VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_MESHSTAGE_API= npm run build' +
      ' && npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
