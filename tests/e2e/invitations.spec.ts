import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
test.use({ actionTimeout: 15000 });
const account = JSON.parse(
  fs.readFileSync(
    process.env.SKYMEET_TEST_ACCOUNTS || ".local/test-accounts.json",
    "utf8",
  ),
)[0];
test("schedule, share invitation, guest preview, waiting room and admission", async ({
  page,
  browser,
}) => {
  await page.goto("./");
  await page.getByLabel("Email address", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start meeting", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/skymeet/api/auth/me")).json();
  const headers = { Origin: "http://localhost:5173", "X-CSRF-Token": me.csrf };
  const title = "Invitation flow " + Date.now();
  let mid = "";
  const context = await browser.newContext(),
    guest = await context.newPage();
  try {
    await page
      .getByRole("button", { name: "Schedule meeting", exact: true })
      .first()
      .click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    const localTime = await page.evaluate(() => {
      const d = new Date();
      return new Date(+d - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    });
    await page.getByLabel("Start", { exact: true }).fill(localTime);
    await page
      .getByRole("button", { name: "Save meeting", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Invite people", level: 1 }),
    ).toBeVisible();
    const list = await (await page.request.get("/skymeet/api/meetings")).json();
    mid = list.find((m: { title: string }) => m.title === title).id;
    const link =
      (await dialog
        .getByRole("link", { name: "Meeting link", exact: true })
        .getAttribute("href")) || "";
    const username = await dialog
      .getByLabel("Meeting username", { exact: true })
      .inputValue();
    const password = await dialog
      .getByLabel("Meeting password", { exact: true })
      .inputValue();
    await expect(
      dialog.getByLabel("Meeting password", { exact: true }),
    ).toHaveAttribute("type", "password");
    await dialog
      .getByRole("button", { name: "Show password", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Meeting password", { exact: true }),
    ).toHaveAttribute("type", "text");
    await dialog
      .getByRole("button", { name: "Hide password", exact: true })
      .click();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as any).__invitationCopy = text;
          },
        },
      }),
    );
    await dialog
      .getByRole("button", { name: "Copy invitation", exact: true })
      .click();
    const copied = await page.evaluate(() => (window as any).__invitationCopy);
    expect(copied).toContain(title);
    expect(copied).toContain(link);
    expect(copied).toContain(username);
    expect(copied).toContain(password);
    await expect(
      dialog.getByRole("link", { name: "Open email app", exact: true }),
    ).toHaveAttribute("href", /^mailto:\?/);
    const check = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      check.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: "test-results/invite-people.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await guest.goto(link);
    await guest.getByLabel("Meeting username", { exact: true }).fill(username);
    await guest
      .getByLabel("Meeting password", { exact: true })
      .fill("wrong-password");
    await guest
      .getByRole("button", { name: "Continue to meeting", exact: true })
      .click();
    await expect(guest.getByRole("alert")).toContainText(
      "Meeting username or password is incorrect",
    );
    const loginCheck = await new AxeBuilder({ page: guest })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      loginCheck.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await guest.setViewportSize({ width: 390, height: 844 });
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await guest.getByLabel("Meeting password", { exact: true }).fill(password);
    await guest
      .getByRole("button", { name: "Continue to meeting", exact: true })
      .click();
    await guest.waitForURL(/\/meeting\//);
    await expect(
      guest.getByText(
        "Meeting access verified. Enter your display name to join.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(guest.url()).not.toContain("#invite=");
    const reschedule = (start: number) =>
      page.request.put(`/skymeet/api/meetings/${mid}`, {
        headers,
        data: {
          title,
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(start + 3600000).toISOString(),
          waiting_room: true,
          guest_policy: "invited",
        },
      });
    expect((await reschedule(Date.now() + 3600000)).ok()).toBeTruthy();
    await guest.reload();
    await guest
      .getByLabel("Display name", { exact: true })
      .fill("Invited Guest");
    await expect(
      guest.getByRole("button", { name: "Not open yet", exact: true }),
    ).toBeDisabled();
    await expect(
      guest.getByText("Joining opens at", { exact: false }),
    ).toBeVisible();
    expect((await reschedule(Date.now() - 60000)).ok()).toBeTruthy();
    await guest.reload();
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.getByRole("button", { name: "العربية", exact: true }).click();
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      guest.getByText("تم التحقق من الدخول. أدخل اسم العرض للانضمام.", {
        exact: true,
      }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "English", exact: true }).click();
    await guest.setViewportSize({ width: 1440, height: 1000 });
    await guest
      .getByLabel("Display name", { exact: true })
      .fill("Invited Guest");
    await guest.screenshot({
      path: "test-results/guest-ready.png",
      fullPage: true,
    });
    const previewCheck = await new AxeBuilder({ page: guest })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      previewCheck.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await guest
      .getByRole("button", { name: "Join meeting", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Waiting for your host" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await page.goto("./meeting/" + mid);
    await page
      .locator(".prejoin-card")
      .getByRole("button", { name: "Join meeting", exact: true })
      .click();
    await expect(page.locator(".call-status")).toHaveText("connected");
    await page
      .locator(".participant")
      .filter({ hasText: "Invited Guest" })
      .getByRole("button", { name: "Admit", exact: true })
      .click();
    await expect(guest.locator(".call-status")).toHaveText("connected");
    const secondContext = await browser.newContext();
    try {
      const second = await secondContext.newPage();
      await second.goto(link);
      await second
        .getByLabel("Meeting username", { exact: true })
        .fill(username);
      await second
        .getByLabel("Meeting password", { exact: true })
        .fill(password);
      await second
        .getByRole("button", { name: "Continue to meeting", exact: true })
        .click();
      await second
        .getByLabel("Display name", { exact: true })
        .fill("Second Guest");
      await second
        .getByRole("button", { name: "Join meeting", exact: true })
        .click();
      await expect(
        second.getByRole("heading", { name: "Waiting for your host" }),
      ).toBeVisible();
      await page
        .locator(".participant")
        .filter({ hasText: "Second Guest" })
        .getByRole("button", { name: "Admit", exact: true })
        .click();
      await expect(second.locator(".call-status")).toHaveText("connected");
      await expect(guest.locator(".call-status")).toHaveText("connected");
      const people = await (
        await page.request.get(`/skymeet/api/meetings/${mid}/participants`)
      ).json();
      expect(
        new Set(people.map((p: { identity: string }) => p.identity)).size,
      ).toBe(3);
      await page.request.post(`/skymeet/api/meetings/${mid}/end`, { headers });
    } finally {
      await secondContext.close();
    }
    await expect(
      guest.getByRole("heading", { name: "Meeting ended", exact: true }),
    ).toBeVisible();
  } finally {
    test.setTimeout(test.info().timeout + 30000);
    await context.close();
    if (mid)
      expect(
        (
          await page.request.delete("/skymeet/api/meetings/" + mid, { headers })
        ).ok(),
      ).toBeTruthy();
  }
});
