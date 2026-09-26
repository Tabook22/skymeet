import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

test.use({ actionTimeout: 15000 });

const accounts = JSON.parse(
  fs.readFileSync(".local/test-accounts.json", "utf8"),
);
async function signIn(page: Page, email: string, password: string) {
  await page.goto("./");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start meeting", exact: true }),
  ).toBeVisible();
}
async function mutate(page: Page, path: string, method: string, data: unknown) {
  const me = await (await page.request.get("/skymeet/api/auth/me")).json();
  return page.request.fetch("/skymeet/api" + path, {
    method,
    data,
    headers: { Origin: "http://localhost:5173", "X-CSRF-Token": me.csrf },
  });
}

test("admin branding, themes, users and own password; employee denied", async ({
  page,
  browser,
}) => {
  await signIn(page, accounts[0].email, accounts[0].password);
  const original = await (
    await page.request.get("/skymeet/api/branding")
  ).json();
  let createdId = "";
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByLabel("Application title", { exact: true })
      .fill("Sky Team");
    await page
      .getByLabel("Application version", { exact: true })
      .fill("2.0 preview");
    const image = {
      name: "brand.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    };
    for (const label of ["Logo", "Application icon"]) {
      await page.getByLabel(label, { exact: true }).setInputFiles(image);
      await expect(
        page.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByAltText(label === "Logo" ? "Logo" : "Favicon"),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page).toHaveTitle("Sky Team · " + original.company_name);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      /\/skymeet\/api\/assets\//,
    );
    await page.reload();
    await expect(
      page.getByLabel("Application version", { exact: true }),
    ).toHaveValue("2.0 preview");
    await page
      .getByRole("button", { name: "Appearance templates", exact: true })
      .click();
    for (const [label, value] of [
      ["Studio", "studio"],
      ["Compact", "compact"],
      ["Garden", "garden"],
    ]) {
      await page.getByRole("radio", { name: new RegExp(label) }).check();
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-template",
        value,
      );
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
    await page.getByRole("button", { name: "People", exact: true }).click();
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const email = `settings-${Date.now()}@example.com`,
      password = "Test-admin-password-123",
      newPassword = "Changed-admin-password-456";
    await dialog.getByLabel("Name", { exact: true }).fill("Settings Test");
    await dialog.getByLabel("Email address", { exact: true }).fill(email);
    await dialog.getByLabel("Password", { exact: true }).fill(password);
    await dialog.getByLabel("Role", { exact: true }).selectOption("admin");
    await dialog
      .getByRole("button", { name: "Create user", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const people = await (
      await page.request.get("/skymeet/api/admin/users")
    ).json();
    createdId = people.find((u: { email: string }) => u.email === email).id;
    await signIn(second, email, password);
    await second.getByRole("link", { name: "Settings", exact: true }).click();
    await second
      .getByRole("button", { name: "My account", exact: true })
      .click();
    await second
      .getByRole("form", { name: "Change my password", exact: true })
      .getByLabel("Current password", { exact: true })
      .fill(password);
    await second.getByLabel("New password", { exact: true }).fill(newPassword);
    await second
      .getByLabel("Confirm new password", { exact: true })
      .fill("Mismatch-password");
    await second
      .getByRole("button", { name: "Change my password", exact: true })
      .click();
    await expect(second.getByRole("alert")).toHaveText(
      "New passwords do not match.",
    );
    await second
      .getByLabel("Confirm new password", { exact: true })
      .fill(newPassword);
    await second
      .getByRole("button", { name: "Change my password", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await signIn(second, email, newPassword);
    await second
      .getByRole("button", { name: "Sign out", exact: true })
      .first()
      .click();
    await signIn(second, accounts[1].email, accounts[1].password);
    await expect(
      second.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    await second.goto("./settings");
    await expect(
      second.getByLabel("Application title", { exact: true }),
    ).toHaveCount(0);
    expect(
      (await mutate(second, "/admin/settings", "PUT", original)).status(),
    ).toBe(403);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Brand & identity", exact: true })
      .click();
    await page.getByRole("button", { name: "العربية", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByLabel("اسم التطبيق")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "English", exact: true }).click();
  } finally {
    test.setTimeout(test.info().timeout + 30000);
    expect(
      (await mutate(page, "/admin/settings", "PUT", original)).ok(),
    ).toBeTruthy();
    if (createdId)
      expect(
        (
          await mutate(page, `/admin/users/${createdId}`, "PATCH", {
            active: false,
          })
        ).ok(),
      ).toBeTruthy();
    await context.close();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page
    .getByRole("button", { name: "Appearance templates", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/admin-settings.png",
    fullPage: true,
  });
});
