import { defineConfig, devices } from '@playwright/test'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load contract addresses and private key from the frontend .env
dotenv.config({ path: path.join(__dirname, '.env') })

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,         // serial – on-chain state is shared
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Vite dev server before running tests
  webServer: {
    command: 'node_modules\\.bin\\vite --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      VITE_VESTING_POOL_MANAGER: process.env.VITE_VESTING_POOL_MANAGER ?? '',
      VITE_TOKEN_ADDRESS: process.env.VITE_TOKEN_ADDRESS ?? '',
      VITE_WALLETCONNECT_PROJECT_ID: process.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'demo',
    },
  },
})
