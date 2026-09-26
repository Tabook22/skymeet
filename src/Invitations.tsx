import { useContext, useEffect, useState } from "react";
import { Button } from "@radix-ui/themes";
import { Copy, Mail, ExternalLink } from "lucide-react";
import { api, type Meeting } from "./api";
import { useApp, ErrorBox, Field, timeFormat } from "./App";
import { Locale, useText } from "./i18n";

type Sharing = {
  meeting: Meeting;
  join_url: string;
  username: string;
  password: string;
  local_only: boolean;
  guests_allowed: boolean;
  waiting_room: boolean;
  closed: boolean;
};

export default function Invitations({
  mid,
  showHeading = true,
}: {
  mid: string;
  showHeading?: boolean;
}) {
  const t = useText(),
    { notice } = useApp(),
    { lang } = useContext(Locale);
  const [info, setInfo] = useState<Sharing | null>(null);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    let active = true;
    setInfo(null);
    setError("");
    setShowPassword(false);
    api<Sharing>(`/meetings/${mid}/sharing`)
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [mid]);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notice(t("Copied"));
    } catch {
      setError(t("Select and copy the invitation below."));
    }
  }
  const formatTime = (value: number) =>
    timeFormat(value, lang, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  const invitation = info
    ? `${info.meeting.title}\n${formatTime(info.meeting.starts)} – ${formatTime(info.meeting.ends)}\n\n${t("Meeting link")}: ${info.join_url}\n${t("Meeting username")}: ${info.username}\n${t("Meeting password")}: ${info.password}\n\n${t("Open the link and enter the meeting username and password. Then enter your name, check your camera and microphone, and select Join meeting.")}\n${info.waiting_room ? t("The host will admit you from the waiting room.") : ""}\n${t("You can join 15 minutes before the scheduled start.")}`
    : "";
  return (
    <section className="invite-panel">
      {showHeading && <h2>{t("Invite people")}</h2>}
      <ErrorBox error={error} />
      {!info && !error && <p role="status">{t("Loading…")}</p>}
      {info && (
        <>
          {info.closed ? (
            <p>{t("This meeting has ended or was cancelled.")}</p>
          ) : !info.guests_allowed ? (
            <p className="invite-note">
              {t(
                "External guests are disabled for this meeting. Enable guest access to share a meeting login.",
              )}
            </p>
          ) : (
            <>
              <p>
                {t(
                  "Your invitation is ready. Copy it and send it to anyone you want to invite.",
                )}
              </p>
              <div className="invitation-ready">
                <div className="field">
                  <span>{t("Meeting link")}</span>
                  <a
                    className="meeting-invitation-link"
                    href={info.join_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("Meeting link")}
                    title={t("Open meeting in a new tab")}
                    dir="ltr"
                  >
                    <span>{info.join_url}</span>
                    <ExternalLink size={16} aria-hidden="true" />
                  </a>
                  <small>{t("Opens in a new tab")}</small>
                </div>
                <Field label={t("Meeting username")}>
                  <input
                    readOnly
                    dir="ltr"
                    value={info.username}
                    onFocus={(e) => e.target.select()}
                  />
                </Field>
                <Field label={t("Meeting password")}>
                  <input
                    type={showPassword ? "text" : "password"}
                    readOnly
                    dir="ltr"
                    value={info.password}
                    onFocus={(e) => e.target.select()}
                  />
                </Field>
                <Button
                  variant="soft"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-pressed={showPassword}
                >
                  {t(showPassword ? "Hide password" : "Show password")}
                </Button>
                <p>
                  {t(
                    "Guests need all three details to join. Share them only with people you want to invite.",
                  )}
                </p>
                <div className="invite-actions">
                  <Button onClick={() => copy(invitation)}>
                    <Copy size={16} />
                    {t("Copy invitation")}
                  </Button>
                  <Button variant="soft" onClick={() => copy(info.join_url)}>
                    {t("Copy link only")}
                  </Button>
                  <a
                    href={`mailto:?subject=${encodeURIComponent(info.meeting.title)}&body=${encodeURIComponent(invitation)}`}
                  >
                    <Mail size={16} /> {t("Open email app")}
                  </a>
                </div>
                <details>
                  <summary>{t("Invitation text")}</summary>
                  <textarea
                    aria-label={t("Invitation text")}
                    readOnly
                    value={invitation}
                    rows={10}
                    onFocus={(e) => e.target.select()}
                  />
                </details>
              </div>
              {info.waiting_room && (
                <p>{t("The host will admit guests from the waiting room.")}</p>
              )}
            </>
          )}
          {info.local_only && (
            <p className="invite-note">
              {t(
                "This is a local preview. People on other devices can use invitations after the app is deployed to your public domain.",
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
