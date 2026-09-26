import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const accounts = JSON.parse(
  fs.readFileSync(
    process.env.SKYMEET_TEST_ACCOUNTS || ".local/test-accounts.json",
    "utf8",
  ),
);
test.use({ actionTimeout: 15000 });
async function login(page: Page, email: string, password: string) {
  await page.goto("./");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
}
test("administrator changes sign-in email and keeps existing password", async ({
  page,
  browser,
}) => {
  await login(page, accounts[0].email, accounts[0].password);
  const me = await (await page.request.get("/skymeet/api/auth/me")).json();
  const headers = { Origin: "http://localhost:5173", "X-CSRF-Token": me.csrf };
  const email = `email-test-${Date.now()}@example.com`,
    next = "changed-" + email,
    password = "Disposable-email-test-123";
  const created = await page.request.post("/skymeet/api/admin/users", {
    headers,
    data: { email, password, name: "Email test", role: "admin" },
  });
  expect(created.ok()).toBeTruthy();
  const user = await created.json();
  const context = await browser.newContext(),
    second = await context.newPage();
  try {
    await login(second, email, password);
    await second.getByRole("link", { name: "Settings", exact: true }).click();
    await second
      .getByRole("button", { name: "My account", exact: true })
      .click();
    const form = second.getByRole("form", {
      name: "Change my email",
      exact: true,
    });
    await form.getByLabel("New email address", { exact: true }).fill(next);
    await form.getByLabel("Current password", { exact: true }).fill("wrong");
    await form
      .getByRole("button", { name: "Change my email", exact: true })
      .click();
    await expect(form.getByRole("alert")).toHaveText(
      "Current password is incorrect.",
    );
    await form.getByLabel("Current password", { exact: true }).fill(password);
    await form
      .getByLabel("New email address", { exact: true })
      .fill(accounts[0].email);
    await form
      .getByRole("button", { name: "Change my email", exact: true })
      .click();
    await expect(form.getByRole("alert")).toHaveText(
      "This email address is already in use.",
    );
    const result = await new AxeBuilder({ page: second })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
    await second.setViewportSize({ width: 390, height: 844 });
    await second.getByRole("button", { name: "العربية", exact: true }).click();
    await expect(
      second.getByLabel("البريد الإلكتروني الجديد", { exact: true }),
    ).toBeVisible();
    expect(
      await second.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await second.getByRole("button", { name: "English", exact: true }).click();
    await form.getByLabel("New email address", { exact: true }).fill(next);
    await form
      .getByRole("button", { name: "Change my email", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await login(second, next, password);
    await second.getByRole("link", { name: "Settings", exact: true }).click();
    await second
      .getByRole("button", { name: "My account", exact: true })
      .click();
    await expect(
      second.getByRole("form", { name: "Change my email", exact: true }),
    ).toContainText(next);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "My account", exact: true }).click();
    await page.screenshot({
      path: "test-results/account-email.png",
      fullPage: true,
    });
  } finally {
    test.setTimeout(test.info().timeout + 30000);
    expect(
      (
        await page.request.patch("/skymeet/api/admin/users/" + user.id, {
          headers,
          data: { active: false },
        })
      ).ok(),
    ).toBeTruthy();
    await context.close();
  }
});
