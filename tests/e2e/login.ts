import { expect, test, type Page } from "@playwright/test";

// The full suite intentionally exercises more logins than one person per minute.
// Respect the real server limiter instead of disabling it for integration tests.
export async function submitLogin(page: Page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const response = await responsePromise;
    if (response.status() !== 429 || attempt === 1) {
      expect(response.status(), "Sign-in response").toBe(200);
      return;
    }
    const seconds = Number(response.headers()["retry-after"] || 60);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    test.setTimeout(test.info().timeout + (seconds + 1) * 1000);
    await page.waitForTimeout((seconds + 1) * 1000);
  }
}
