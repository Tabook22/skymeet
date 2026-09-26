import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Dialog } from "@radix-ui/themes";
import {
  LiveKitRoom,
  PreJoin,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  MediaDeviceMenu,
  useTracks,
  useConnectionState,
  useChat,
  useLocalParticipant,
  useSpeakingParticipants,
  type PreJoinProps,
  type LocalUserChoices,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Hand,
  ShieldCheck,
  Users,
  MessageSquare,
  LogOut,
  Video,
  Volume2,
  Copy,
  Mic,
} from "lucide-react";
import { api, base, APIError, setCSRF, type Meeting, type Person } from "./api";
import { Locale, useText } from "./i18n";
import {
  useApp,
  ErrorBox,
  LanguageButton,
  Mark,
  Confirm,
  Invitations,
  timeFormat,
} from "./App";

export function GuestExchange() {
  const t = useText(),
    navigate = useNavigate();
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const raw = new URLSearchParams(location.hash.slice(1)).get("invite");
    history.replaceState(null, "", location.pathname);
    if (!raw) {
      setError(t("Open the invitation link sent by your host."));
      return;
    }
    api("/guest/exchange", "POST", { token: raw })
      .then((r) => {
        if (r.requires_credentials) {
          navigate("/join/" + r.meeting_id, { replace: true });
          return;
        }
        setCSRF(r.csrf);
        navigate("/meeting/" + r.meeting_id, { replace: true });
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="center-page">
      <Mark />
      <h1>{t(error ? "Personal invitation required" : "Loading…")}</h1>
      <ErrorBox error={error} />
      <Link to="/">{t("Back to workspace")}</Link>
    </main>
  );
}

export default function MeetingPage() {
  const { id } = useParams(),
    t = useText(),
    { user, brand } = useApp(),
    { lang } = useContext(Locale);
  const [meeting, setMeeting] = useState<Meeting | null>(null),
    [error, setError] = useState(""),
    [choices, setChoices] = useState<LocalUserChoices | null>(null),
    [waiting, setWaiting] = useState(false),
    [credentials, setCredentials] = useState<{
      token: string;
      url: string;
    } | null>(null),
    [left, setLeft] = useState(false),
    [people, setPeople] = useState<Person[]>([]),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const tooEarly = !!meeting && clock / 1000 < meeting.starts - 900;
  const tokenRequested = useRef(false);
  useEffect(() => {
    if (waiting || credentials) return;
    let alive = true;
    const refresh = () =>
      api<Meeting>("/meetings/" + id)
        .then((m) => {
          if (alive) setMeeting(m);
        })
        .catch((e) => {
          if (!alive) return;
          setError(e.message);
          if (e instanceof APIError && e.status === 404) setMeeting(null);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, left, waiting, !!credentials]);
  useEffect(() => {
    if (!waiting && !credentials) return;
    let alive = true;
    async function poll() {
      try {
        const [m, p] = await Promise.all([
          api<Meeting>("/meetings/" + id),
          api<Person[]>(`/meetings/${id}/participants`),
        ]);
        if (!alive) return;
        setMeeting(m);
        setPeople(p);
        const self = p.find((x) => x.identity === m.identity);
        if (
          ["ended", "cancelled"].includes(m.status) ||
          (self && ["denied", "removed"].includes(self.decision))
        ) {
          setCredentials(null);
          setWaiting(false);
          setLeft(true);
          if (self?.decision === "removed" || self?.decision === "denied")
            setError(t(self.decision));
          return;
        }
        if (
          waiting &&
          self?.decision === "admitted" &&
          !tokenRequested.current
        ) {
          tokenRequested.current = true;
          try {
            const c = await api(`/meetings/${id}/token`, "POST");
            if (alive) {
              setCredentials(c);
              setWaiting(false);
            }
          } catch (e) {
            setError((e as Error).message);
            tokenRequested.current = false;
          }
        }
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          if (e instanceof APIError && e.status === 404) {
            setCredentials(null);
            setWaiting(false);
            setLeft(true);
            setMeeting(null);
          }
        }
      }
    }
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [waiting, !!credentials, id]);
  async function join(value: LocalUserChoices) {
    if (busy || tooEarly) return;
    setBusy(true);
    setError("");
    try {
      setChoices(value);
      tokenRequested.current = false;
      await api(`/meetings/${id}/join`, "POST", {
        name: value.username || user?.name || t("Guest"),
      });
      setWaiting(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function leave() {
    setCredentials(null);
    setWaiting(false);
    setLeft(true);
  }
  async function openNow() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/meetings/${id}/open`, "POST");
      setMeeting(await api<Meeting>(`/meetings/${id}`));
      setClock(Date.now());
      setLeft(false);
      setPeople([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (credentials && choices && meeting)
    return (
      <LiveKitRoom
        token={credentials.token}
        serverUrl={credentials.url}
        connect
        audio={
          choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false
        }
        video={
          choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false
        }
        options={{ adaptiveStream: true, dynacast: true }}
        onDisconnected={leave}
        onError={(e) => setError(e.message)}
        data-lk-theme="default"
        className="live-room"
      >
        <Call
          meeting={meeting}
          people={people}
          leave={leave}
          error={error}
          setError={setError}
        />
      </LiveKitRoom>
    );
  const ended =
    meeting &&
    (["ended", "cancelled"].includes(meeting.status) ||
      clock / 1000 >= meeting.ends + 1800);
  const openControl = user?.role === "admin" &&
    meeting &&
    (meeting.status !== "active" || ended) && (
      <div className="invite-note">
        <p>
          {t(
            "Open now for the scheduled duration. The meeting link and login stay the same. Attendees wait for your admission.",
          )}
        </p>
        <Button disabled={busy} onClick={openNow}>
          {t(busy ? "Working…" : ended ? "Reopen meeting" : "Open meeting now")}
        </Button>
      </div>
    );
  return (
    <div className="join-page">
      <header className="join-header">
        <Link to="/" className="brand">
          <Mark />
          <span>{brand.application_title}</span>
        </Link>
        <LanguageButton />
      </header>
      <main className="join-main">
        <ErrorBox error={error} />
        {!meeting ? (
          <div className="center-content">
            <h1>{t(error ? "Meeting unavailable" : "Loading…")}</h1>
            <Link to="/">{t("Back to workspace")}</Link>
          </div>
        ) : left || ended ? (
          <div className="post-meeting">
            <span className="post-icon">
              <CheckIcon />
            </span>
            <span className="eyebrow">SKY MEET</span>
            <h1>
              {t(
                ended
                  ? meeting.status === "cancelled"
                    ? "Meeting cancelled"
                    : "Meeting ended"
                  : "You have left the meeting",
              )}
            </h1>
            <p>{t("Thanks for making the time.")}</p>
            <div className="post-card">
              <h2>{meeting.title}</h2>
              <p>{timeFormat(meeting.starts, lang)}</p>
              {meeting.started_at && (
                <p>
                  {Math.max(
                    0,
                    Math.round(
                      ((meeting.ended_at || Date.now() / 1000) -
                        meeting.started_at) /
                        60,
                    ),
                  )}{" "}
                  {t("minutes")}
                </p>
              )}
              <span>
                <ShieldCheck size={16} />
                {t("No recording was made.")}
              </span>
            </div>
            <div className="inline-buttons">
              {!ended && (
                <Button
                  onClick={() => {
                    setLeft(false);
                    setError("");
                  }}
                >
                  {t("Rejoin")}
                </Button>
              )}
              <Link to="/">{t("Back to workspace")}</Link>
            </div>
            {openControl}
          </div>
        ) : waiting ? (
          <div className="waiting-screen">
            <div className="waiting-animation">
              <Users size={38} />
            </div>
            <span className="eyebrow">{meeting.title}</span>
            <h1>{t("Waiting for your host")}</h1>
            <p>
              {t("Your host will let you in shortly. Keep this page open.")}
            </p>
            <Button
              variant="soft"
              color="gray"
              onClick={() => setWaiting(false)}
            >
              {t("Leave")}
            </Button>
          </div>
        ) : (
          <>
            <div className="prejoin-heading">
              <span className="eyebrow">{t("Get ready to join")}</span>
              <h1>{meeting.title}</h1>
              <p>
                {timeFormat(meeting.starts, lang)} ·{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
              <p>
                {t(
                  "Enter your name, choose your camera and microphone settings, then join.",
                )}
              </p>
              {!user && (
                <p>
                  {t(
                    "Meeting access verified. Enter your display name to join.",
                  )}
                </p>
              )}
              {tooEarly && (
                <p className="invite-note" role="status">
                  {t("Joining opens at")}{" "}
                  {timeFormat(meeting.starts - 900, lang)}
                </p>
              )}
              {openControl}
              <a
                className="text-link"
                href={`${base}/api/meetings/${meeting.id}/calendar`}
              >
                {t("Add to calendar")}
              </a>
            </div>
            <div className="prejoin-card" data-lk-theme="default">
              <AccessiblePreJoin
                defaults={{
                  username: user?.name || "",
                  audioEnabled: false,
                  videoEnabled: false,
                }}
                persistUserChoices={false}
                onSubmit={join}
                onValidate={(values) =>
                  !!values.username.trim() &&
                  values.username.length <= 80 &&
                  !busy &&
                  !tooEarly
                }
                onError={(e) =>
                  setError(
                    t(
                      "Camera and microphone access needs permission in your browser.",
                    ) +
                      " " +
                      e.message,
                  )
                }
                joinLabel={t(
                  tooEarly
                    ? "Not open yet"
                    : busy
                      ? "Loading…"
                      : "Join meeting",
                )}
                userLabel={t("Display name")}
                micLabel={t("Microphone")}
                camLabel={t("Camera")}
              />
              <details className="audio-checks">
                <summary>{t("Test audio devices")}</summary>
                <DeviceTests />
              </details>
            </div>
            <p className="join-policy">
              <ShieldCheck size={15} />
              {t("Unrecorded meeting")} ·{" "}
              {t(
                "This meeting opens 15 minutes early and ends 30 minutes after its scheduled end.",
              )}
            </p>
            {meeting.is_host && (
              <div className="prejoin-invites">
                <Invitations mid={meeting.id} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
function CheckIcon() {
  return <ShieldCheck size={32} />;
}

function AccessiblePreJoin(props: PreJoinProps) {
  const root = useRef<HTMLDivElement>(null);
  const t = useText();
  const { lang } = useContext(Locale);
  useEffect(() => {
    root.current
      ?.querySelectorAll<HTMLButtonElement>(".lk-button-group-menu button")
      .forEach((button, i) => {
        button.setAttribute(
          "aria-label",
          t(i === 0 ? "Microphone devices" : "Camera devices"),
        );
      });
  }, [lang]);
  return (
    <div ref={root}>
      <label className="sr-only" htmlFor="username">
        {t("Display name")}
      </label>
      <PreJoin {...props} />
    </div>
  );
}

function DeviceTests() {
  const t = useText(),
    { notice } = useApp();
  const [level, setLevel] = useState(0),
    [error, setError] = useState(""),
    [testing, setTesting] = useState(false);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  async function testMic() {
    try {
      cleanup.current();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const timer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        setLevel(
          Math.min(100, (data.reduce((a, b) => a + b, 0) / data.length) * 2),
        );
      }, 100);
      let timeout: ReturnType<typeof setTimeout>;
      cleanup.current = () => {
        clearInterval(timer);
        clearTimeout(timeout);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        setTesting(false);
        setLevel(0);
      };
      setTesting(true);
      timeout = setTimeout(() => cleanup.current(), 8000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function sound() {
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      oscillator.frequency.value = 523;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.6);
      oscillator.onended = () => {
        ctx.close();
      };
      notice(t("Sound test played"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="device-tests">
      <div>
        <Button type="button" variant="soft" color="gray" onClick={sound}>
          <Volume2 size={16} />
          {t("Test speakers")}
        </Button>
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={testMic}
          disabled={testing}
        >
          <Mic size={16} />
          {t("Microphone level")}
        </Button>
        <meter
          aria-label={t("Microphone level")}
          min={0}
          max={100}
          value={level}
        />
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Call({
  meeting,
  people,
  leave,
  error,
  setError,
}: {
  meeting: Meeting;
  people: Person[];
  leave: () => void;
  error: string;
  setError: (s: string) => void;
}) {
  const t = useText(),
    { notice } = useApp();
  const [panel, setPanel] = useState<"people" | "chat" | null>("people"),
    [inviteOpen, setInviteOpen] = useState(false);
  const connection = useConnectionState();
  const chat = useChat();
  const speakers = useSpeakingParticipants();
  const [speakerView, setSpeakerView] = useState(false);
  const { localParticipant } = useLocalParticipant();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const shares = tracks.filter((x) => x.source === Track.Source.ScreenShare);
  const speaker =
    tracks.find(
      (x) =>
        x.source === Track.Source.Camera &&
        x.participant.identity === speakers[0]?.identity,
    ) || tracks.find((x) => x.source === Track.Source.Camera);
  const focusedTrack = shares[0] || (speakerView ? speaker : undefined);
  const own = people.find((p) => p.identity === localParticipant.identity);
  async function action(path: string, body?: unknown) {
    try {
      await api(`/meetings/${meeting.id}${path}`, "POST", body);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <header className="call-header">
        <div>
          <Mark />
          <h1>{meeting.title}</h1>
          <span className="call-status">
            <i />
            {t(connection)}
          </span>
        </div>
        <div>
          <span className="unrecorded">
            <ShieldCheck size={15} />
            {t("Unrecorded meeting")}
          </span>
          <LanguageButton />
        </div>
      </header>
      <ErrorBox error={error} />
      <div className="call-content">
        <div className={"stage " + (focusedTrack ? "has-share" : "")}>
          {focusedTrack ? (
            <>
              <div className="shared-screen">
                <ParticipantTile trackRef={focusedTrack} />
              </div>
              <div className="filmstrip">
                {tracks
                  .filter((x) => x.source === Track.Source.Camera)
                  .map((track) => (
                    <ParticipantTile
                      key={track.participant.identity}
                      trackRef={track}
                    />
                  ))}
              </div>
            </>
          ) : (
            <GridLayout tracks={tracks}>
              <ParticipantTile />
            </GridLayout>
          )}
        </div>
        {panel && (
          <aside className="call-panel">
            <div className="panel-heading">
              <h2>{t(panel === "people" ? "Participants" : "Chat")}</h2>
              <button aria-label={t("Close")} onClick={() => setPanel(null)}>
                ×
              </button>
            </div>
            {panel === "chat" ? (
              <MeetingChat chat={chat} />
            ) : (
              <>
                <div className="participant-list">
                  {people
                    .filter((p) => meeting.is_host || p.decision === "admitted")
                    .map((p) => (
                      <div className="participant" key={p.id}>
                        <div>
                          <span className="avatar">{p.name.slice(0, 1)}</span>
                          <span>
                            <strong>
                              {p.name} {p.raised && "✋"}
                            </strong>
                            <small>
                              {t(p.decision)}
                              {p.connected ? " · " + t("connected") : ""}
                            </small>
                          </span>
                        </div>
                        {meeting.is_host &&
                          p.identity !== localParticipant.identity && (
                            <div className="participant-actions">
                              {p.decision === "waiting" ? (
                                <>
                                  <Button
                                    size="1"
                                    onClick={() =>
                                      action(`/participants/${p.id}/decision`, {
                                        decision: "admitted",
                                      })
                                    }
                                  >
                                    {t("Admit")}
                                  </Button>
                                  <Button
                                    size="1"
                                    color="gray"
                                    onClick={() =>
                                      action(`/participants/${p.id}/decision`, {
                                        decision: "denied",
                                      })
                                    }
                                  >
                                    {t("Deny")}
                                  </Button>
                                </>
                              ) : p.decision === "admitted" ? (
                                <>
                                  <button
                                    onClick={() =>
                                      action(`/participants/${p.id}/mute`)
                                    }
                                  >
                                    {t("Mute")}
                                  </button>
                                  <button
                                    className="danger-text"
                                    onClick={() =>
                                      action(`/participants/${p.id}/decision`, {
                                        decision: "removed",
                                      })
                                    }
                                  >
                                    {t("Remove")}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          )}
                      </div>
                    ))}
                </div>
                {meeting.is_host && (
                  <div className="host-panel">
                    <Button
                      variant="soft"
                      onClick={() =>
                        action("/lock", { locked: !meeting.locked })
                      }
                    >
                      {t(meeting.locked ? "Unlock room" : "Lock room")}
                    </Button>
                    <Button variant="soft" onClick={() => setInviteOpen(true)}>
                      <Copy size={15} />
                      {t("Invitations")}
                    </Button>
                    <Confirm
                      label={t("End for everyone")}
                      onConfirm={() => action("/end")}
                    />
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>
      <footer className="call-controls">
        <div className="device-group">
          <TrackToggle source={Track.Source.Microphone} showIcon>
            {t("Microphone")}
          </TrackToggle>
          <MediaDeviceMenu
            kind="audioinput"
            aria-label={t("Microphone devices")}
          />
        </div>
        <div className="device-group">
          <TrackToggle source={Track.Source.Camera} showIcon>
            {t("Camera")}
          </TrackToggle>
          <MediaDeviceMenu kind="videoinput" aria-label={t("Camera devices")} />
        </div>
        <TrackToggle source={Track.Source.ScreenShare} showIcon>
          {t("Screen share")}
        </TrackToggle>
        <button onClick={() => setSpeakerView(!speakerView)}>
          <Video size={19} />
          {t(speakerView ? "Grid view" : "Speaker view")}
        </button>
        <button
          className={own?.raised ? "control-active" : ""}
          onClick={() => action("/hand", { raised: !own?.raised })}
        >
          <Hand size={19} />
          {t(own?.raised ? "Lower hand" : "Raise hand")}
        </button>
        <button
          className={panel === "people" ? "control-active" : ""}
          onClick={() => setPanel(panel === "people" ? null : "people")}
        >
          <Users size={19} />
          {t("Participants")}
        </button>
        <button
          className={panel === "chat" ? "control-active" : ""}
          onClick={() => setPanel(panel === "chat" ? null : "chat")}
        >
          <MessageSquare size={19} />
          {t("Chat")}
        </button>
        <button
          className="leave-button"
          onClick={() => {
            localParticipant.setMicrophoneEnabled(false);
            leave();
          }}
        >
          <LogOut size={18} />
          {t("Leave")}
        </button>
      </footer>
      <RoomAudioRenderer />
      <Dialog.Root open={inviteOpen} onOpenChange={setInviteOpen}>
        <Dialog.Content maxWidth="650px">
          <Dialog.Title>{t("Invitations")}</Dialog.Title>
          <Dialog.Description>
            {t("Company-owned meetings. Protected invitations.")}
          </Dialog.Description>
          <Invitations mid={meeting.id} showHeading={false} />
          <div className="dialog-actions">
            <Dialog.Close>
              <Button>{t("Close")}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

function MeetingChat({ chat }: { chat: ReturnType<typeof useChat> }) {
  const t = useText();
  const { chatMessages, send, isSending } = chat;
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [chatMessages]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await send(text.trim());
      setText("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="meeting-chat">
      <div className="chat-messages" aria-live="polite">
        {chatMessages.map((m, i) => (
          <div className="chat-message" key={i}>
            <strong>{m.from?.name || t("Guest")}</strong>
            <p>{m.message}</p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <ErrorBox error={error} />
      <form onSubmit={submit}>
        <input
          aria-label={t("Write a message")}
          placeholder={t("Write a message")}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={isSending || !text.trim()}>
          {t("Send")}
        </Button>
      </form>
    </div>
  );
}
