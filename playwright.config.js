const { defineConfig, devices } = require("@playwright/test");

const port = process.env.PORT || "5173";
const baseURL = `http://localhost:${port}`;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `PORT=${port} npm run serve`,
    url: `${baseURL}/index.html`,
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
