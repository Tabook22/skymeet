import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
test.use({ actionTimeout: 15000, timezoneId: "Asia/Muscat" });
const account = JSON.parse(
  fs.readFileSync(
    process.env.SKYMEET_TEST_ACCOUNTS || ".local/test-accounts.json",
    "utf8",
  ),
)[0];

test("year/month filters, local calendar grouping and direct deletion", async ({
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
  const mutate = (path: string, method: string, data?: unknown) =>
    page.request.fetch("/skymeet/api" + path, { headers, method, data });
  const prefix = "Calendar " + Date.now(),
    year = new Date().getFullYear() + 1,
    ids: string[] = [];
  try {
    for (const [name, start] of [
      ["February", `${year}-02-15T10:00:00Z`],
      ["March", `${year}-03-15T10:00:00Z`],
      ["Boundary", `${year}-12-31T21:00:00Z`],
    ]) {
      const r = await mutate("/meetings", "POST", {
        title: prefix + " " + name,
        starts_at: start,
        ends_at: new Date(+new Date(start) + 3600000).toISOString(),
      });
      expect(r.ok()).toBeTruthy();
      ids.push((await r.json()).id);
    }
    expect(
      (await mutate("/meetings/" + ids[0] + "/end", "POST")).ok(),
    ).toBeTruthy();
    await page.getByRole("link", { name: "Meetings", exact: true }).click();
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    const rows = page.locator(".meeting-row"),
      headings = page.locator(".meeting-group-heading");
    await expect(rows).toHaveCount(3);
    await expect(headings).toHaveCount(3);
    await expect(headings.first()).toContainText("February " + year);
    await expect(headings.last()).toContainText("January " + (year + 1));
    await page.getByLabel("Group by", { exact: true }).selectOption("year");
    await expect(headings).toHaveCount(2);
    await page
      .getByLabel("Sort by date", { exact: true })
      .selectOption("descending");
    await expect(headings.first()).toContainText(String(year + 1));
    await page.getByLabel("Group by", { exact: true }).selectOption("none");
    await expect(headings).toHaveCount(0);
    await page.getByLabel("Year", { exact: true }).selectOption(String(year));
    await page.getByLabel("Month", { exact: true }).selectOption("1");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("February");
    await rows
      .getByRole("button", { name: "Delete meeting", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(prefix + " February");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(rows).toHaveCount(1);
    await rows
      .getByRole("button", { name: "Delete meeting", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "No meetings match these filters" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(page.getByLabel("Year", { exact: true })).toHaveValue("all");
    await expect(page.getByLabel("Month", { exact: true })).toHaveValue("all");
    await expect(
      page.getByLabel("Search meetings", { exact: true }),
    ).toHaveValue("");
    await page.getByLabel("Search meetings", { exact: true }).fill(prefix);
    await page.getByLabel("Group by", { exact: true }).selectOption("month");
    await page.getByLabel("Month", { exact: true }).selectOption("0");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Boundary");
    await expect(headings.first()).toContainText("January " + (year + 1));
    await page.getByLabel("Month", { exact: true }).selectOption("all");
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      a11y.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: "test-results/calendar-groups.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "العربية", exact: true }).click();
    await page
      .getByLabel("السنة", { exact: true })
      .selectOption(String(year + 1));
    await page.getByLabel("الشهر", { exact: true }).selectOption("0");
    await expect(rows).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/calendar-groups-arabic.png",
      fullPage: true,
    });
    await rows
      .getByRole("button", { name: "حذف الاجتماع", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "تأكيد", exact: true })
      .click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByLabel("السنة", { exact: true })).toHaveValue(
      String(year + 1),
    );
  } finally {
    test.setTimeout(test.info().timeout + 30000);
    for (const id of ids)
      expect([200, 404]).toContain(
        (await mutate("/meetings/" + id, "DELETE")).status(),
      );
  }
});
