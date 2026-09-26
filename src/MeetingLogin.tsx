import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@radix-ui/themes";
import { api, setCSRF } from "./api";
import {
  ErrorBox,
  Field,
  LanguageButton,
  Mark,
  timeFormat,
  useApp,
} from "./App";
import { useText } from "./i18n";

type MeetingInfo = {
  id: string;
  title: string;
  starts: number;
  closed: boolean;
  guests_allowed: boolean;
};
export default function MeetingLogin() {
  const { id } = useParams(),
    navigate = useNavigate(),
    t = useText(),
    { user, brand } = useApp();
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setMeeting(null);
    setError("");
    api<MeetingInfo>(`/guest/meeting/${id}`)
      .then((m) => {
        if (active) setMeeting(m);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/guest/meeting/${id}/login`,
        "POST",
        Object.fromEntries(new FormData(form)),
      );
      setCSRF(result.csrf);
      form.reset();
      navigate(`/meeting/${id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="meeting-login-page">
      <header>
        <Link className="brand" to="/">
          <Mark />
          <span>{brand.application_title}</span>
        </Link>
        <LanguageButton />
      </header>
      <section className="meeting-login-card">
        <p className="eyebrow">{t("Meeting invitation")}</p>
        <h1>{meeting?.title || t("Join meeting")}</h1>
        {meeting && <p>{timeFormat(meeting.starts)}</p>}
        <ErrorBox error={t(error)} />
        {!meeting && !error && <p role="status">{t("Loading…")}</p>}
        {meeting &&
          (meeting.closed ? (
            <p>{t("This meeting has ended or was cancelled.")}</p>
          ) : (
            <>
              {meeting.guests_allowed ? (
                <form onSubmit={submit}>
                  <p>
                    {t(
                      "Enter the meeting username and password from your invitation.",
                    )}
                  </p>
                  <Field label={t("Meeting username")}>
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      maxLength={32}
                      dir="ltr"
                    />
                  </Field>
                  <Field label={t("Meeting password")}>
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                      dir="ltr"
                    />
                  </Field>
                  <Button type="submit" disabled={busy}>
                    {t(busy ? "Loading…" : "Continue to meeting")}
                  </Button>
                  <small>
                    {t(
                      "These are meeting credentials, separate from your account login.",
                    )}
                  </small>
                </form>
              ) : (
                <p>{t("External guests are disabled for this meeting.")}</p>
              )}
              {user && (
                <p>
                  <Link to={`/meeting/${id}`}>{t("Open with my account")}</Link>
                </p>
              )}
            </>
          ))}
      </section>
    </main>
  );
}
