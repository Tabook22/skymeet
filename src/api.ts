export const base = import.meta.env.BASE_URL.replace(/\/$/, "");
let csrf = "";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const upload = body instanceof FormData;
  const response = await fetch(`${base}/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body && !upload ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new APIError(
      data.error || "Unable to complete the request. Please try again.",
      response.status,
    );
  return data as T;
}
export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
  active: boolean;
};
export type Meeting = {
  id: string;
  host_id: string;
  title: string;
  description: string;
  starts: number;
  ends: number;
  timezone: string;
  status: string;
  guest_policy: string;
  waiting_room: boolean;
  locked: boolean;
  started_at: number | null;
  ended_at: number | null;
  is_host?: boolean;
  identity?: string;
};
export type Person = {
  id: string;
  identity: string;
  name: string;
  decision: string;
  connected: boolean;
  raised: boolean;
};
export type Branding = {
  application_title: string;
  application_version: string;
  appearance_template: "garden" | "studio" | "compact";
  company_name: string;
  primary_color: string;
  support_email: string;
  logo_url: string;
  favicon_url: string;
  default_duration: number;
  employees_can_create: boolean;
  external_guests: boolean;
  waiting_room: boolean;
  default_guest_policy: string;
  email_enabled: boolean;
  reminders_enabled: boolean;
  reminder_minutes: number;
  recording_policy: "disabled";
};
