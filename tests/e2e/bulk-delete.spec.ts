import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
const account = JSON.parse(
  fs.readFileSync(
    process.env.SKYMEET_TEST_ACCOUNTS || ".local/test-accounts.json",
    "utf8",
  ),
)[0];

test("single deletion, multiple selection, filtered select-all, cancellation and stale list refresh", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByLabel("Email address", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Meetings", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/skymeet/api/auth/me")).json();
  const headers = { Origin: "http://localhost:5173", "X-CSRF-Token": me.csrf };
  const prefix = "Bulk QA " + Date.now(),
    ids: string[] = [];
  const existing = await (
    await page.request.get("/skymeet/api/meetings")
  ).json();
  try {
    for (let i = 0; i < 5; i++) {
      const start = Date.now() + 86400000 + i * 60000;
      const result = await page.request.post("/skymeet/api/meetings", {
        headers,
        data: {
          title: prefix + (i === 4 ? " keep" : " duplicate"),
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(start + 3600000).toISOString(),
        },
      });
      expect(result.ok()).toBeTruthy();
      const mid = (await result.json()).id;
      ids.push(mid);
      expect(
        (
          await page.request.post(`/skymeet/api/meetings/${mid}/end`, {
            headers,
          })
        ).ok(),
      ).toBeTruthy();
    }
    await page.getByRole("link", { name: "Meetings", exact: true }).click();
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    const rows = page.locator(".meeting-row");
    await expect(rows).toHaveCount(5);
    // Single delete immediately removes exactly one duplicate and persists after reload.
    await rows
      .first()
      .getByRole("button", { name: "Delete meeting", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(rows).toHaveCount(4);
    await page.reload();
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    await expect(rows).toHaveCount(4);
    await rows.nth(0).getByRole("checkbox").check();
    await rows.nth(1).getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Delete selected (2)", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toHaveText(
      "Delete selected meetings: 2",
    );
    await expect(dialog.locator("li")).toHaveCount(2);
    const check = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      check.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page
      .getByRole("button", { name: "Delete selected (2)", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await page
      .getByRole("checkbox", {
        name: "Select all matching meetings",
        exact: true,
      })
      .check();
    await expect(
      page.getByRole("button", { name: "Delete selected (2)", exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("Search meetings", { exact: true })
      .fill(prefix + " duplicate");
    await expect(
      page.getByRole("button", { name: "Delete selected (0)", exact: true }),
    ).toBeDisabled();
    await expect(rows).toHaveCount(1);
    await page
      .getByRole("checkbox", {
        name: "Select all matching meetings",
        exact: true,
      })
      .check();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "العربية", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/bulk-delete-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "حذف المحدد (1)", exact: true })
      .click();
    await dialog.getByRole("button", { name: "تأكيد", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("keep");
    // Changes made in another view are picked up on returning to this view.
    expect(
      (
        await page.request.delete("/skymeet/api/meetings/" + ids[4], {
          headers,
        })
      ).ok(),
    ).toBeTruthy();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(rows).toHaveCount(0);
    const remaining = await (
      await page.request.get("/skymeet/api/meetings")
    ).json();
    for (const m of existing)
      expect(remaining.some((r: { id: string }) => r.id === m.id)).toBeTruthy();
  } finally {
    for (const id of ids)
      expect([200, 404]).toContain(
        (
          await page.request.delete("/skymeet/api/meetings/" + id, { headers })
        ).status(),
      );
  }
});
