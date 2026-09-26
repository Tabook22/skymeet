import { submitLogin } from "./login";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

const accounts = JSON.parse(
  fs.readFileSync(".local/test-accounts.json", "utf8"),
);
test("accessible login, dashboard and pre-join", async ({ page }) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  const check = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  };
  await check();
  await page
    .getByLabel("Email address", { exact: true })
    .fill(accounts[1].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[1].password);
  await submitLogin(page);
  await expect(
    page.getByRole("button", { name: "Start meeting", exact: true }),
  ).toBeVisible();
  await check();
  await page
    .getByRole("button", { name: "Start meeting", exact: true })
    .click();
  await page.waitForURL(/\/meeting\//);
  await expect(
    page
      .locator(".prejoin-card")
      .getByRole("button", { name: "Join meeting", exact: true }),
  ).toBeVisible();
  await check();
});
