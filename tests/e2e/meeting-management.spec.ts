import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

test.use({ actionTimeout: 15000 });
const accounts = JSON.parse(
  fs.readFileSync(".local/test-accounts.json", "utf8"),
);
test("admin sorts, reschedules, repeats and deletes employee meetings", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(accounts[0].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[0].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Meetings", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/skymeet/api/auth/me")).json();
  const headers = {
    Origin: "http://localhost:5173",
    "X-CSRF-Token": session.csrf,
  };
  const mutate = (path: string, method: string, data?: unknown) =>
    page.request.fetch("/skymeet/api" + path, { method, headers, data });
  const people = await (
    await page.request.get("/skymeet/api/admin/users")
  ).json();
  const host = people.find(
    (u: { email: string }) => u.email === accounts[1].email,
  );
  const prefix = "Manage " + Date.now(),
    ids = new Set<string>();
  const start = Date.now() + 86400000;
  try {
    for (const [name, offset] of [
      ["Early", 0],
      ["Late", 86400000],
    ] as const) {
      const r = await mutate("/meetings", "POST", {
        title: prefix + " " + name,
        host_id: host.id,
        starts_at: new Date(start + offset).toISOString(),
        ends_at: new Date(start + offset + 3600000).toISOString(),
      });
      expect(r.ok()).toBeTruthy();
      ids.add((await r.json()).id);
    }
    await page.getByRole("link", { name: "Meetings", exact: true }).click();
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    const rows = page.locator(".meeting-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Early");
    await page
      .getByLabel("Sort by date", { exact: true })
      .selectOption("descending");
    await expect(rows.first()).toContainText("Late");
    await page
      .getByLabel("Sort by date", { exact: true })
      .selectOption("ascending");
    await rows
      .filter({ hasText: "Early" })
      .getByRole("button", { name: "Manage", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reschedule meeting", exact: true })
      .click();
    const localTime = (milliseconds: number) =>
      page.evaluate((ms) => {
        const d = new Date(ms);
        return new Date(+d - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      }, milliseconds);
    await page
      .getByLabel("Start", { exact: true })
      .fill(await localTime(start + 3 * 86400000));
    await page
      .getByLabel("End", { exact: true })
      .fill(await localTime(start + 3 * 86400000 + 3600000));
    await page
      .getByRole("button", { name: "Save meeting", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rows.first()).toContainText("Late");
    const earlyId = [...ids][0];
    await mutate(`/meetings/${earlyId}/cancel`, "POST");
    await page.reload();
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    await rows
      .filter({ hasText: "Early" })
      .getByRole("button", { name: "Manage", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Schedule again", exact: true })
      .click();
    await page.getByLabel("Title", { exact: true }).fill(prefix + " Repeated");
    await page
      .getByRole("button", { name: "Save meeting", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rows).toHaveCount(3);
    const updated = await (
      await page.request.get("/skymeet/api/meetings")
    ).json();
    const repeated = updated.find(
      (m: { title: string }) => m.title === prefix + " Repeated",
    );
    ids.add(repeated.id);
    expect(repeated.host_id).toBe(host.id);
    expect(updated.find((m: { id: string }) => m.id === earlyId).status).toBe(
      "cancelled",
    );
    await rows
      .filter({ hasText: "Late" })
      .getByRole("button", { name: "Manage", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete meeting", exact: true })
      .click();
    await expect(
      page.getByText("Permanently delete this meeting", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Late" })).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "العربية", exact: true }).click();
    await expect(
      page.getByLabel("الترتيب حسب التاريخ", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "test-results/meeting-management.png",
      fullPage: true,
    });
  } finally {
    test.setTimeout(test.info().timeout + 30000);
    for (const id of ids) {
      const result = await mutate("/meetings/" + id, "DELETE");
      expect([200, 404]).toContain(result.status());
    }
  }
});
