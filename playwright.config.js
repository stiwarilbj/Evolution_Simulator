import { defineConfig } from '@playwright/test'

const pagesUrl = process.env.PAGES_URL
const previewPort = 43170
const previewPath = '/Evolution_Simulator/'
const previewUrl = `http://127.0.0.1:${previewPort}${previewPath}`

export default defineConfig({
  testDir: './browser',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: pagesUrl || previewUrl,
    viewport: { width: 1280, height: 900 },
  },
  webServer: pagesUrl ? undefined : {
    command: `npm run preview -- --host 127.0.0.1 --port ${previewPort} --strictPort --base ${previewPath}`,
    url: previewUrl,
  },
})
