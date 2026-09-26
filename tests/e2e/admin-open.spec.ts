import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { submitLogin } from "./login";

const account = JSON.parse(
  fs.readFileSync(
    process.env.SKYMEET_TEST_ACCOUNTS || ".local/test-accounts.json",
    "utf8",
  ),
)[0];

test("admin opens a future meeting, admits guests, and reopens the same link", async ({
  page,
  browser,
}) => {
  await page.goto("./");
  await page.getByLabel("Email address", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await submitLogin(page);
  await expect(
    page.getByRole("button", { name: "Start meeting", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/skymeet/api/auth/me")).json();
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf };
  const start = Date.now() + 7 * 86400000;
  const created = await page.request.post("/skymeet/api/meetings", {
    headers,
    data: {
      title: "Open anytime QA " + Date.now(),
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + 3600000).toISOString(),
      waiting_room: true,
    },
  });
  expect(created.status()).toBe(201);
  const m = await created.json();
  const path = "/skymeet/api/meetings/" + m.id;
  const guestContext = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const guest = await guestContext.newPage();
  try {
    await page.goto("./meeting/" + m.id);
    const sharing = await (await page.request.get(path + "/sharing")).json();
    await guest.goto(sharing.join_url);
    await guest
      .getByLabel("Meeting username", { exact: true })
      .fill(sharing.username);
    await guest
      .getByLabel("Meeting password", { exact: true })
      .fill(sharing.password);
    await guest
      .getByRole("button", { name: "Continue to meeting", exact: true })
      .click();
    await expect(
      guest.getByRole("button", { name: "Not open yet", exact: true }),
    ).toBeDisabled();
    await expect(
      guest.getByRole("button", { name: "Open meeting now", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open meeting now", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Join meeting", exact: true }),
    ).toBeEnabled();
    // The guest's existing pre-join screen updates without a manual reload.
    await guest
      .getByPlaceholder("Display name", { exact: true })
      .fill("Waiting Guest QA");
    await expect(
      guest.getByRole("button", { name: "Join meeting", exact: true }),
    ).toBeEnabled();
    await guest
      .getByRole("button", { name: "Join meeting", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Waiting for your host" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Join meeting", exact: true })
      .click();
    await expect(page.locator(".call-status")).toHaveText("connected");
    await page
      .locator(".participant")
      .filter({ hasText: "Waiting Guest QA" })
      .getByRole("button", { name: "Admit", exact: true })
      .click();
    await expect(guest.locator(".call-status")).toHaveText("connected");
    expect(
      (await page.request.post(path + "/end", { headers })).ok(),
    ).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Reopen meeting", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reopen meeting", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Join meeting", exact: true }),
    ).toBeEnabled();
    const reopened = await (await page.request.get(path + "/sharing")).json();
    expect(reopened.join_url).toBe(sharing.join_url);
    expect(reopened.password).toBe(sharing.password);
    await guest.goto(sharing.join_url);
    await guest
      .getByLabel("Meeting username", { exact: true })
      .fill(sharing.username);
    await guest
      .getByLabel("Meeting password", { exact: true })
      .fill(sharing.password);
    await guest
      .getByRole("button", { name: "Continue to meeting", exact: true })
      .click();
    await guest
      .getByPlaceholder("Display name", { exact: true })
      .fill("Returning Guest QA");
    await guest
      .getByRole("button", { name: "Join meeting", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Waiting for your host" }),
    ).toBeVisible();
  } finally {
    expect((await page.request.delete(path, { headers })).ok()).toBeTruthy();
    await guestContext.close();
  }
});
