import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";

const accounts = JSON.parse(
  fs.readFileSync(
    process.env.SKYMEET_TEST_ACCOUNTS || ".local/test-accounts.json",
    "utf8",
  ),
);
async function login(page: Page, index: number) {
  await page.goto("./");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(accounts[index].email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts[index].password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start meeting", exact: true }),
  ).toBeVisible();
}

test("real self-hosted call: employee host, invited employee, guest, media, chat, refresh, host controls", async ({
  browser,
  page,
}) => {
  await page.addInitScript(() => {
    // Test screen-track transport without capturing the operator's desktop.
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      const context = canvas.getContext("2d")!;
      const timer = setInterval(() => {
        context.fillStyle = "#17694b";
        context.fillRect(0, 0, 960, 540);
        context.fillStyle = "#fff";
        context.font = "36px sans-serif";
        context.fillText("Sky Meet synthetic screen " + Date.now(), 30, 100);
      }, 100);
      const stream = canvas.captureStream(10);
      stream
        .getVideoTracks()[0]
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await login(page, 1);
  await page
    .getByRole("button", { name: "Start meeting", exact: true })
    .click();
  await page.waitForURL(/\/meeting\//);
  await expect(
    page.getByRole("heading", { name: /Sara Ahmed · Sky Meet/, level: 1 }),
  ).toBeVisible();
  const meetingUrl = page.url();
  const guestUrl =
    (await page
      .getByRole("link", { name: "Meeting link", exact: true })
      .getAttribute("href")) || "";
  const meetingUsername = await page
    .getByLabel("Meeting username", { exact: true })
    .inputValue();
  const meetingPassword = await page
    .getByLabel("Meeting password", { exact: true })
    .inputValue();
  const mid = meetingUrl.split("/").pop();
  const me = await (await page.request.get("/skymeet/api/auth/me")).json();
  const requestHeaders = {
    Origin: "http://localhost:5173",
    "X-CSRF-Token": me.csrf,
  };
  expect(
    (
      await page.request.post(`/skymeet/api/meetings/${mid}/invitations`, {
        headers: requestHeaders,
        data: { email: accounts[2].email, send_email: false },
      })
    ).ok(),
  ).toBeTruthy();
  // Real Chromium getUserMedia sources are generated test media, never the user's camera.
  await page.getByRole("button", { name: "Microphone", exact: true }).click();
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("button", { name: "Join meeting", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Leave", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".call-status")).toHaveText("connected");

  const guestContext = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const guest = await guestContext.newPage();
  await guest.goto(guestUrl);
  await guest
    .getByLabel("Meeting username", { exact: true })
    .fill(meetingUsername);
  await guest
    .getByLabel("Meeting password", { exact: true })
    .fill(meetingPassword);
  await guest
    .getByRole("button", { name: "Continue to meeting", exact: true })
    .click();
  await guest
    .getByPlaceholder("Display name", { exact: true })
    .fill("External Guest");
  await guest.getByRole("button", { name: "Microphone", exact: true }).click();
  await guest.getByRole("button", { name: "Camera", exact: true }).click();
  await guest
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "Waiting for your host" }),
  ).toBeVisible();
  const guestRow = page
    .locator(".participant")
    .filter({ hasText: "External Guest" });
  await guestRow.getByRole("button", { name: "Admit", exact: true }).click();
  await expect(guest.locator(".call-status")).toHaveText("connected");
  await expect(page.locator(".lk-participant-tile")).toHaveCount(2);
  await expect(guest.locator(".lk-participant-tile")).toHaveCount(2);
  // Decoding video frames on each browser proves actual inbound RTP media, not just signaling.
  for (const p of [page, guest]) {
    await expect
      .poll(async () =>
        p
          .locator(
            '.lk-participant-tile[data-lk-local-participant="false"] video',
          )
          .evaluateAll(
            (videos) =>
              videos.filter((v) => v.videoWidth > 0 && v.currentTime > 0.1)
                .length,
          ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        p
          .locator("audio")
          .evaluateAll(
            (audios) =>
              audios.filter(
                (a) =>
                  a.srcObject &&
                  a.currentTime > 0.1 &&
                  (a.srcObject as MediaStream)
                    .getAudioTracks()
                    .some((t) => t.readyState === "live"),
              ).length,
          ),
      )
      .toBeGreaterThan(0);
  }
  await page.screenshot({ path: "test-results/real-local-call.png" });
  const callAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    callAccessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await guestRow.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "Microphone", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await guest.getByRole("button", { name: "Microphone", exact: true }).click();
  await page.getByRole("button", { name: "Speaker view", exact: true }).click();
  await expect(page.locator(".shared-screen")).toBeVisible();
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await page.getByRole("button", { name: "Screen share", exact: true }).click();
  await expect
    .poll(() =>
      guest
        .locator(".shared-screen video")
        .evaluateAll(
          (videos) =>
            videos.filter((v) => v.videoWidth > 0 && v.currentTime > 0).length,
        ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Screen share", exact: true }).click();
  await expect(guest.locator(".shared-screen")).toHaveCount(0);

  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await guest.getByRole("button", { name: "Chat", exact: true }).click();
  await guest
    .getByLabel("Write a message")
    .fill("Hello from a real invited guest");
  await guest.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Hello from a real invited guest", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Participants", exact: true }).click();
  await guest.getByRole("button", { name: "Raise hand", exact: true }).click();
  await expect(guestRow).toContainText("✋");

  const employeeContext = await browser.newContext();
  const employee = await employeeContext.newPage();
  await login(employee, 2);
  await employee.goto(meetingUrl);
  await employee
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  const employeeRow = page
    .locator(".participant")
    .filter({ hasText: "Omar Ali" });
  await employeeRow.getByRole("button", { name: "Admit", exact: true }).click();
  await expect(employee.locator(".call-status")).toHaveText("connected");
  await expect(page.locator(".lk-participant-tile")).toHaveCount(3);

  await guest.reload();
  await guest
    .getByPlaceholder("Display name", { exact: true })
    .fill("External Guest");
  await guest
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  await expect(guest.locator(".call-status")).toHaveText("connected");
  await page.getByRole("button", { name: "Lock room", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unlock room", exact: true }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "Leave", exact: true }).click();
  await guest.getByRole("button", { name: "Rejoin", exact: true }).click();
  await guest
    .getByPlaceholder("Display name", { exact: true })
    .fill("External Guest");
  await guest
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  await expect(guest.getByRole("alert")).toContainText("locked");
  await page.getByRole("button", { name: "Unlock room", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lock room", exact: true }),
  ).toBeVisible();
  const rejoinTokenResponse = guest.waitForResponse(
    (r) => r.url().endsWith("/token") && r.request().method() === "POST",
  );
  await guest
    .getByRole("button", { name: "Join meeting", exact: true })
    .click();
  const previouslyIssued = (await (await rejoinTokenResponse).json()).token;
  await expect(guest.locator(".call-status")).toHaveText("connected");
  await guestRow.getByRole("button", { name: "Remove", exact: true }).click();
  const replay = await guest.request.get(
    "http://localhost:7883/rtc?access_token=" +
      encodeURIComponent(previouslyIssued),
  );
  expect(replay.status()).toBe(403);
  await expect(
    guest.getByRole("heading", {
      name: "You have left the meeting",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "End for everyone", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    employee.getByRole("heading", { name: "Meeting ended", exact: true }),
  ).toBeVisible();
  await guestContext.close();
  await employeeContext.close();
  expect(
    (
      await page.request.delete(`/skymeet/api/meetings/${mid}`, {
        headers: requestHeaders,
      })
    ).ok(),
  ).toBeTruthy();
});

test("responsive English and Arabic workspace and scheduling", async ({
  page,
}) => {
  await login(page, 0);
  await expect(page.locator('.empty[role="status"]')).toHaveCount(0);
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Schedule meeting", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Local QA · scheduled meeting");
  await page.getByRole("button", { name: "Save meeting", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page
      .getByRole("heading", {
        name: "Local QA · scheduled meeting",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("button", { name: "بدء اجتماع", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBeTruthy();
  await page.screenshot({
    path: "test-results/dashboard-arabic-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
});
