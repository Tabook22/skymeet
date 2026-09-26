import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/runs",
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173/skymeet/",
    viewport: { width: 1440, height: 1000 },
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    trace: "off", // Invitation capabilities and auth bodies must not be captured in traces.
    screenshot: "only-on-failure",
  },
});
