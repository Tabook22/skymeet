import {
  useEffect,
  useState,
  useRef,
  createContext,
  useContext,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { Button, Dialog, Switch, Badge, Checkbox } from "@radix-ui/themes";
import {
  Video,
  LayoutDashboard,
  CalendarDays,
  Users,
  Settings,
  LogOut,
  Plus,
  ArrowUpRight,
  Search,
  ShieldCheck,
  ArrowRight,
  Globe2,
  Clock3,
  X,
  Leaf,
  Check,
  Mail,
  Copy,
  ChevronRight,
} from "lucide-react";
import {
  api,
  APIError,
  base,
  setCSRF,
  type Branding,
  type Meeting,
  type User,
} from "./api";
import { Locale, useText, type Language } from "./i18n";
import MeetingPage, { GuestExchange } from "./Meeting";
import Invitations from "./Invitations";
import MeetingLogin from "./MeetingLogin";
export { Invitations };

type AppState = {
  user: User | null;
  brand: Branding;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
};
export const AppContext = createContext<AppState>(null!);
export function useApp() {
  return useContext(AppContext);
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Mark() {
  const { brand } = useApp();
  if (brand.favicon_url)
    return <img className="app-icon" src={base + brand.favicon_url} alt="" />;
  return (
    <span className="mark">
      <Video size={23} strokeWidth={2.2} />
    </span>
  );
}
export function timeFormat(
  value: number,
  lang = "en",
  options?: Intl.DateTimeFormatOptions,
) {
  return new Date(value * 1000).toLocaleString(
    lang === "ar" ? "ar-OM" : "en-GB",
    options || {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

export default function App() {
  const routeLocation = useLocation();
  const [lang, updateLang] = useState<Language>(
    (localStorage.getItem("sky-language") as Language) || "en",
  );
  const [user, setUser] = useState<User | null>(null),
    [brand, setBrand] = useState<Branding | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function refresh() {
    const [session, branding] = await Promise.all([
      api("/auth/me"),
      api<Branding>("/branding"),
    ]);
    setUser(session.user);
    setCSRF(session.csrf);
    setBrand(branding);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [routeLocation.pathname, user?.id]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("sky-language", lang);
  }, [lang]);
  useEffect(() => {
    if (brand) {
      document.documentElement.style.setProperty(
        "--brand",
        brand.primary_color,
      );
      document.title = `${brand.application_title} · ${brand.company_name}`;
      document.documentElement.dataset.template = brand.appearance_template;
      if (brand.favicon_url) {
        let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (!icon) {
          icon = document.createElement("link");
          icon.rel = "icon";
          document.head.append(icon);
        }
        icon.href = base + brand.favicon_url;
      } else {
        document.querySelector('link[rel="icon"]')?.remove();
      }
    }
  }, [brand]);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(""), 6500);
      return () => clearTimeout(id);
    }
  }, [notice]);
  if (error)
    return (
      <main className="center-page">
        <h1>Sky Meet</h1>
        <ErrorBox error={error} />
        <Button onClick={() => location.reload()}>
          Try again / حاول مجدداً
        </Button>
      </main>
    );
  if (!brand)
    return (
      <main className="center-page" role="status">
        Sky Meet · Loading… / جار التحميل…
      </main>
    );
  return (
    <Locale.Provider value={{ lang, setLang: updateLang }}>
      <AppContext.Provider value={{ user, brand, refresh, notice: setNotice }}>
        <Routes>
          <Route path="/join" element={<GuestExchange />} />
          <Route path="/join/:id" element={<MeetingLogin />} />
          <Route path="/meeting/:id" element={<MeetingPage />} />
          <Route path="*" element={user ? <Shell /> : <Login />} />
        </Routes>
        {notice && (
          <div className="toast" role="status">
            <Check size={18} />
            {notice}
            <button aria-label="Close" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
      </AppContext.Provider>
    </Locale.Provider>
  );
}

export function LanguageButton() {
  const { lang, setLang } = useContext(Locale);
  return (
    <button
      className="language"
      onClick={() => setLang(lang === "en" ? "ar" : "en")}
    >
      <Globe2 size={16} />
      {lang === "en" ? "العربية" : "English"}
    </button>
  );
}

function Login() {
  const { brand, refresh } = useApp(),
    t = useText();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/auth/login", "POST", Object.fromEntries(f));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-art">
        <Link to="/" className="brand white">
          {brand.logo_url ? (
            <img src={base + brand.logo_url} alt="" />
          ) : (
            <Mark />
          )}
          <span>
            {brand.application_title}
            <small>{brand.company_name}</small>
          </span>
        </Link>
        <div className="login-message">
          <span className="eyebrow">{brand.company_name}</span>
          <h1>{t("Your team. One shared space.")}</h1>
          <p>{t("A private place to connect.")}</p>
          <div className="orbital">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-center">
              <Video size={62} />
            </div>
            <span className="orbit-avatar one">S</span>
            <span className="orbit-avatar two">A</span>
            <span className="orbit-avatar three">
              <Leaf size={25} />
            </span>
          </div>
        </div>
        <span className="login-foot">
          <ShieldCheck size={17} />
          {t("Company-owned meetings. Protected invitations.")}
        </span>
      </section>
      <section className="login-form-area">
        <div className="login-language">
          <LanguageButton />
        </div>
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">{t("Employee sign-in")}</span>
          <h2>{t("Welcome back")}</h2>
          <p className="muted">{t("Use your company account to continue.")}</p>
          <ErrorBox error={error} />
          <Field label={t("Email address")}>
            <input
              autoComplete="username"
              type="email"
              name="email"
              required
              placeholder="you@company.com"
            />
          </Field>
          <Field label={t("Password")}>
            <input
              autoComplete="current-password"
              type="password"
              name="password"
              required
              minLength={1}
            />
          </Field>
          <Button size="3" disabled={busy} type="submit">
            {t(busy ? "Loading…" : "Sign in")}
            <ArrowRight size={17} />
          </Button>
          <p className="help">
            {t("Need access? Contact your administrator.")}{" "}
            <a href={`mailto:${brand.support_email}`}>{brand.support_email}</a>
          </p>
        </form>
        <div className="login-copyright">
          © {new Date().getFullYear()} {brand.company_name} ·{" "}
          {brand.application_title} · v{brand.application_version}
        </div>
      </section>
    </div>
  );
}

function Shell() {
  const { user, brand, refresh } = useApp(),
    t = useText(),
    navigate = useNavigate();
  async function logout() {
    await api("/auth/logout", "POST");
    await refresh();
    navigate("/");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          {brand.logo_url ? (
            <img src={base + brand.logo_url} alt="" />
          ) : (
            <Mark />
          )}
          <span>
            {brand.application_title}
            <small>{brand.company_name}</small>
          </span>
        </Link>
        <span className="nav-label">{t("Workspace")}</span>
        <nav>
          <NavLink to="/" end>
            <LayoutDashboard size={19} />
            {t("Overview")}
          </NavLink>
          <NavLink to="/meetings">
            <CalendarDays size={19} />
            {t("Meetings")}
          </NavLink>
          {user?.role === "admin" && (
            <>
              <NavLink to="/people">
                <Users size={19} />
                {t("People")}
              </NavLink>
              <NavLink to="/settings">
                <Settings size={19} />
                {t("Settings")}
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={21} />
            <strong>{t("Private by design")}</strong>
            <p>{t("Company-owned meetings. Protected invitations.")}</p>
          </div>
          <div className="profile">
            <span className="avatar">{user?.name.slice(0, 1)}</span>
            <span>
              <strong>{user?.name}</strong>
              <small>{t(user?.role || "")}</small>
            </span>
            <button
              title={t("Sign out")}
              aria-label={t("Sign out")}
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="breadcrumb">
            {brand.company_name}
            <ChevronRight size={13} />
            <b>{t("Workspace")}</b>
          </span>
          <div className="topbar-right">
            <span className="secure-dot">{t("Secure workspace")}</span>
            <LanguageButton />
            <button
              className="mobile-signout"
              aria-label={t("Sign out")}
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="workspace">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/meetings" element={<Dashboard all />} />
            <Route
              path="/people"
              element={user?.role === "admin" ? <People /> : <Dashboard />}
            />
            <Route
              path="/settings"
              element={
                user?.role === "admin" ? <SettingsPage /> : <Dashboard />
              }
            />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <footer className="workspace-footer">
          <span>
            {brand.application_title} · v{brand.application_version} ·{" "}
            {brand.company_name}
          </span>
          <span>{t("A private place to connect.")}</span>
        </footer>
      </div>
    </div>
  );
}

function Dashboard({ all = false }: { all?: boolean }) {
  const { user, brand } = useApp(),
    { lang } = useContext(Locale),
    t = useText(),
    navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [schedule, setSchedule] = useState(false),
    [selected, setSelected] = useState<Meeting | null>(null),
    [inviteMeeting, setInviteMeeting] = useState<Meeting | null>(null),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState(all ? "All" : "Upcoming"),
    [dateOrder, setDateOrder] = useState("ascending"),
    [year, setYear] = useState("all"),
    [month, setMonth] = useState("all"),
    [groupBy, setGroupBy] = useState("month"),
    [starting, setStarting] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const loadVersion = useRef(0);
  const load = async () => {
    const version = ++loadVersion.current;
    try {
      const next = await api<Meeting[]>("/meetings");
      if (version !== loadVersion.current) return;
      setMeetings(next);
      setError("");
      setCheckedIds(
        (previous) =>
          new Set([...previous].filter((id) => next.some((m) => m.id === id))),
      );
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    load();
    setTab(all ? "All" : "Upcoming");
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      ++loadVersion.current;
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [all]);
  useEffect(() => {
    setCheckedIds(new Set());
  }, [all, tab, search, year, month]);
  function removeMeetings(ids: string[]) {
    ++loadVersion.current;
    const removed = new Set(ids);
    setMeetings((previous) => previous.filter((m) => !removed.has(m.id)));
    setCheckedIds(
      (previous) => new Set([...previous].filter((id) => !removed.has(id))),
    );
    setError("");
  }
  const upcoming = meetings
    .filter(
      (m) =>
        !["ended", "cancelled"].includes(m.status) &&
        m.ends + 1800 > Date.now() / 1000,
    )
    .sort((a, b) => a.starts - b.starts);
  const recent = meetings.filter((m) => !upcoming.includes(m));
  const years = [
    ...new Set(meetings.map((m) => new Date(m.starts * 1000).getFullYear())),
  ].sort((a, b) => b - a);
  const dateLocale = lang === "ar" ? "ar-OM-u-ca-gregory" : "en-GB";
  const visible = (
    tab === "All" ? meetings : tab === "Upcoming" ? upcoming : recent
  )
    .filter((m) => {
      const date = new Date(m.starts * 1000);
      return (
        m.title.toLowerCase().includes(search.toLowerCase()) &&
        (year === "all" || date.getFullYear() === Number(year)) &&
        (month === "all" || date.getMonth() === Number(month))
      );
    })
    .sort(
      (a, b) =>
        (dateOrder === "ascending"
          ? a.starts - b.starts
          : b.starts - a.starts) || a.id.localeCompare(b.id),
    );
  const groups: { key: string; label: string; items: Meeting[] }[] = [];
  const manageable = visible.filter(
    (m) => user?.role === "admin" || user?.id === m.host_id,
  );
  const checkedMeetings = manageable.filter((m) => checkedIds.has(m.id));
  for (const meeting of visible) {
    const date = new Date(meeting.starts * 1000);
    const key =
      groupBy === "none"
        ? "all"
        : groupBy === "year"
          ? String(date.getFullYear())
          : `${date.getFullYear()}-${date.getMonth()}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = {
        key,
        label: date.toLocaleDateString(
          dateLocale,
          groupBy === "year"
            ? { year: "numeric" }
            : { month: "long", year: "numeric" },
        ),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(meeting);
  }
  const canCreate = user?.role === "admin" || brand.employees_can_create;
  async function start() {
    setStarting(true);
    try {
      const now = new Date();
      const m = await api("/meetings", "POST", {
        title: `${user?.name} · Sky Meet`,
        starts_at: now.toISOString(),
        ends_at: new Date(+now + brand.default_duration * 60000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        waiting_room: brand.waiting_room,
        guest_policy: brand.default_guest_policy,
      });
      navigate("/meeting/" + m.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  const hour = new Date().getHours();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {timeFormat(Date.now() / 1000, lang, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <h1>
            {all
              ? t("All meetings")
              : `${t(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening")}, ${user?.name.split(" ")[0]}`}
            {!all && <span className="greeting-dot">.</span>}
          </h1>
          <p>{t("Your workspace, connected.")}</p>
        </div>
        {canCreate && (
          <Button size="3" variant="outline" onClick={() => setSchedule(true)}>
            <Plus size={17} />
            {t("Schedule meeting")}
          </Button>
        )}
      </div>
      <ErrorBox error={error} />
      {!all && (
        <section className="hero">
          <div className="hero-copy">
            <span className="hero-label">
              <span /> SKY MEET
            </span>
            <h2>{t("Your next conversation starts here.")}</h2>
            <p>{t("Connect with your team, wherever work takes you.")}</p>
            {canCreate && (
              <Button
                className="hero-button"
                size="3"
                onClick={start}
                disabled={starting}
              >
                <Video size={19} />
                {t(starting ? "Loading…" : "Start meeting")}
                <ArrowUpRight size={18} />
              </Button>
            )}
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="visual-ring ring-a" />
            <div className="visual-ring ring-b" />
            <div className="floating-card card-a">
              <span className="visual-avatar av-a">S</span>
              <span className="visual-line" />
              <span className="visual-bars">▂ ▅ ▃ ▆ ▂</span>
            </div>
            <div className="floating-card card-b">
              <span className="visual-avatar av-b">A</span>
              <span className="visual-line" />
              <span className="visual-camera">
                <Video size={15} />
              </span>
            </div>
            <div className="connected-pill">
              <span />
              {t("Your workspace, connected.")}
            </div>
            <span className="visual-star">✦</span>
          </div>
        </section>
      )}
      <div className="stats">
        <Stat
          icon={<CalendarDays />}
          value={upcoming.length}
          label={t("Scheduled meetings")}
        />
        <Stat
          icon={<Video />}
          value={meetings.filter((m) => m.status === "active").length}
          label={t("In progress")}
        />
        <Stat
          icon={<Check />}
          value={meetings.filter((m) => m.status === "ended").length}
          label={t("Completed")}
        />
      </div>
      <section className="meetings-section">
        <div className="section-title">
          <h2>
            {t("Meetings")} <span className="count">{meetings.length}</span>
          </h2>
          {!all && (
            <Link className="text-link" to="/meetings">
              {t("View all")}
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
        <div className="list-toolbar">
          <div className="tabs" role="tablist">
            {["All", "Upcoming", "Recent"].map((x) => (
              <button
                role="tab"
                aria-selected={tab === x}
                className={tab === x ? "selected" : ""}
                key={x}
                onClick={() => setTab(x)}
              >
                {t(x)}
                <span>
                  {x === "All"
                    ? meetings.length
                    : x === "Upcoming"
                      ? upcoming.length
                      : recent.length}
                </span>
              </button>
            ))}
          </div>
          <label className="date-sort">
            <span>{t("Sort by date")}</span>
            <select
              aria-label={t("Sort by date")}
              value={dateOrder}
              onChange={(e) => setDateOrder(e.target.value)}
            >
              <option value="ascending">{t("Earliest first")}</option>
              <option value="descending">{t("Latest first")}</option>
            </select>
          </label>
          <label className="search">
            <Search size={16} />
            <input
              aria-label={t("Search meetings")}
              placeholder={t("Search meetings")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="date-filters">
          <Field label={t("Year")}>
            <select
              aria-label={t("Year")}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="all">{t("All years")}</option>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value.toLocaleString(dateLocale, { useGrouping: false })}
                </option>
              ))}
              {year !== "all" && !years.includes(Number(year)) && (
                <option value={year}>{year}</option>
              )}
            </select>
          </Field>
          <Field label={t("Month")}>
            <select
              aria-label={t("Month")}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="all">{t("All months")}</option>
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index} value={index}>
                  {new Date(2024, index, 1).toLocaleDateString(dateLocale, {
                    month: "long",
                  })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Group by")}>
            <select
              aria-label={t("Group by")}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              <option value="month">{t("Month")}</option>
              <option value="year">{t("Year")}</option>
              <option value="none">{t("No grouping")}</option>
            </select>
          </Field>
          <Button
            type="button"
            variant="soft"
            color="gray"
            disabled={year === "all" && month === "all" && !search}
            onClick={() => {
              setYear("all");
              setMonth("all");
              setSearch("");
            }}
          >
            {t("Clear filters")}
          </Button>
        </div>
        <p className="filter-summary" role="status">
          {t("Matching meetings")}: {visible.length} · {t("Timezone")}:{" "}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        {!loading && manageable.length > 0 && (
          <div className="bulk-meeting-actions">
            <label className="meeting-select-all">
              <Checkbox
                aria-label={t("Select all matching meetings")}
                checked={
                  checkedMeetings.length === manageable.length
                    ? true
                    : checkedMeetings.length
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(value) =>
                  setCheckedIds(
                    value === true
                      ? new Set(manageable.map((m) => m.id))
                      : new Set(),
                  )
                }
              />
              {t("Select all matching meetings")} ({manageable.length})
            </label>
            <span role="status">
              {t("Selected")}: {checkedMeetings.length}
            </span>
            <BulkDeleteMeetings
              meetings={checkedMeetings}
              onDeleted={removeMeetings}
            />
            {checkedMeetings.length > 0 && (
              <Button
                variant="ghost"
                color="gray"
                onClick={() => setCheckedIds(new Set())}
              >
                {t("Clear selection")}
              </Button>
            )}
            <small>
              {t(
                "Selection applies only to meetings in this filtered list that you can manage.",
              )}
            </small>
          </div>
        )}
        {loading ? (
          <div className="empty" role="status">
            {t("Loading…")}
          </div>
        ) : !visible.length ? (
          <div className="empty">
            <span className="empty-icon">
              <CalendarDays size={28} />
            </span>
            <h3>
              {t(
                meetings.length
                  ? "No meetings match these filters"
                  : "No meetings yet",
              )}
            </h3>
            <p>
              {t(
                meetings.length
                  ? "Try another year or month, clear your search, or select All."
                  : "Make room for your next conversation.",
              )}
            </p>
            {canCreate && (
              <Button variant="soft" onClick={() => setSchedule(true)}>
                <Plus size={15} />
                {t("Schedule meeting")}
              </Button>
            )}
          </div>
        ) : (
          <div className="meeting-groups">
            {groups.map((group) => (
              <section className="meeting-group" key={group.key}>
                {groupBy !== "none" && (
                  <h3 className="meeting-group-heading">
                    {group.label}{" "}
                    <span className="count">{group.items.length}</span>
                  </h3>
                )}
                <div className="meeting-list">
                  {group.items.map((m) => (
                    <article key={m.id} className="meeting-row">
                      {(user?.role === "admin" || user?.id === m.host_id) && (
                        <Checkbox
                          className="meeting-select"
                          aria-label={`${t("Select meeting")}: ${m.title} · ${timeFormat(m.starts, lang)}`}
                          checked={checkedIds.has(m.id)}
                          onCheckedChange={(value) =>
                            setCheckedIds((previous) => {
                              const next = new Set(previous);
                              if (value === true) next.add(m.id);
                              else next.delete(m.id);
                              return next;
                            })
                          }
                        />
                      )}
                      <div className="date-tile">
                        <span>
                          {timeFormat(m.starts, lang, { month: "short" })}
                        </span>
                        <strong>
                          {timeFormat(m.starts, lang, { day: "numeric" })}
                        </strong>
                      </div>
                      <div className="meeting-info">
                        <h4>{m.title}</h4>
                        <div className="meeting-meta">
                          <span>
                            <Clock3 size={13} />
                            {timeFormat(m.starts, lang, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            –{" "}
                            {timeFormat(m.ends, lang, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span>
                            <ShieldCheck size={13} />
                            {t(
                              m.waiting_room
                                ? "Waiting room"
                                : "Password-protected guests",
                            )}
                          </span>
                        </div>
                      </div>
                      <Badge color={m.status === "active" ? "green" : "gray"}>
                        {t(m.status)}
                      </Badge>
                      <div className="row-actions">
                        {(user?.role === "admin" || user?.id === m.host_id) && (
                          <>
                            <Button
                              variant="ghost"
                              color="gray"
                              onClick={() => setSelected(m)}
                            >
                              {t("Manage")}
                            </Button>
                            {!["ended", "cancelled"].includes(m.status) && (
                              <Button
                                variant="soft"
                                onClick={() => setInviteMeeting(m)}
                              >
                                <Mail size={14} />
                                {t("Invite")}
                              </Button>
                            )}
                            <DeleteMeetingButton
                              meeting={m}
                              onDeleted={() => removeMeetings([m.id])}
                            />
                          </>
                        )}
                        <Button
                          variant="soft"
                          onClick={() => navigate("/meeting/" + m.id)}
                        >
                          {t(
                            upcoming.includes(m)
                              ? "Join meeting"
                              : "Meeting details",
                          )}
                          <ArrowUpRight size={15} />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
      <ScheduleDialog
        open={schedule}
        setOpen={setSchedule}
        onSave={(meeting) => {
          load();
          if (meeting) setInviteMeeting(meeting);
        }}
      />
      <Dialog.Root
        open={!!inviteMeeting}
        onOpenChange={(open) => !open && setInviteMeeting(null)}
      >
        <Dialog.Content maxWidth="720px">
          <Dialog.Title>{t("Invite people")}</Dialog.Title>
          <Dialog.Description>{inviteMeeting?.title}</Dialog.Description>
          {inviteMeeting && (
            <Invitations mid={inviteMeeting.id} showHeading={false} />
          )}
          <div className="dialog-actions">
            <Dialog.Close>
              <Button variant="soft">{t("Done")}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      {selected && (
        <ManageDialog
          meeting={selected}
          close={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </>
  );
}
function Stat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <span>
        <strong>{value.toString().padStart(2, "0")}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

function localDate(t: number) {
  const d = new Date(t);
  return new Date(+d - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function ScheduleDialog({
  open,
  setOpen,
  onSave,
  meeting,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  onSave: (meeting?: Meeting) => void;
  meeting?: Meeting;
}) {
  const { brand, notice, user } = useApp(),
    t = useText();
  const repeat = !!meeting && meeting.status !== "scheduled";
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hosts, setHosts] = useState<User[]>([]);
  useEffect(() => {
    if (open && user?.role === "admin" && !meeting)
      api<User[]>("/admin/users")
        .then(setHosts)
        .catch((e) => setError(e.message));
  }, [open]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const data = {
        title: f.get("title"),
        description: f.get("description"),
        starts_at: new Date(String(f.get("start"))).toISOString(),
        ends_at: new Date(String(f.get("end"))).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        host_id: f.get("host") || (repeat ? meeting?.host_id : undefined),
        guest_policy: f.get("guest_policy"),
        waiting_room: f.get("waiting") === "on",
        invited_emails: String(f.get("emails") || "")
          .split(/[\n,;]/)
          .map((x) => x.trim())
          .filter(Boolean),
      };
      const result = await api(
        meeting && !repeat ? "/meetings/" + meeting.id : "/meetings",
        meeting && !repeat ? "PUT" : "POST",
        data,
      );
      const failed = result.invitations?.some(
        (i: any) => i.delivery === "failed",
      );
      const unsent = result.invitations?.some(
        (i: any) => i.delivery === "disabled",
      );
      notice(
        t(
          failed
            ? "Email could not be sent. Copy and share the invitation instead."
            : unsent
              ? "Automatic email is off. Copy and share the invitation."
              : "Saved",
        ),
      );
      setOpen(false);
      onSave(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Content maxWidth="570px">
        <Dialog.Title>
          {t(
            meeting
              ? repeat
                ? "Schedule again"
                : "Reschedule meeting"
              : "Schedule meeting",
          )}
        </Dialog.Title>
        <Dialog.Description size="2" className="muted">
          {t(
            "This meeting opens 15 minutes early and ends 30 minutes after its scheduled end.",
          )}
        </Dialog.Description>
        {meeting && (
          <p className="muted">
            {t(
              repeat
                ? "This creates a new meeting with new invitations. The original meeting and its history stay unchanged."
                : "Rescheduling updates invitation links. Resend invitations to notify guests of the new time.",
            )}
          </p>
        )}
        <form onSubmit={submit} className="dialog-form">
          <ErrorBox error={error} />
          <Field label={t("Title")}>
            <input
              name="title"
              maxLength={160}
              defaultValue={meeting?.title}
              required
              autoFocus
            />
          </Field>
          <Field label={t("Description")}>
            <textarea
              name="description"
              maxLength={4000}
              defaultValue={meeting?.description}
              rows={2}
            />
          </Field>
          <div className="form-grid">
            <Field label={t("Start")}>
              <input
                type="datetime-local"
                name="start"
                required
                defaultValue={localDate(
                  meeting && !repeat
                    ? meeting.starts * 1000
                    : Date.now() + 15 * 60000,
                )}
              />
            </Field>
            <Field label={t("End")}>
              <input
                type="datetime-local"
                name="end"
                required
                defaultValue={localDate(
                  meeting && !repeat
                    ? meeting.ends * 1000
                    : Date.now() +
                        15 * 60000 +
                        (meeting
                          ? (meeting.ends - meeting.starts) * 1000
                          : brand.default_duration * 60000),
                )}
              />
            </Field>
          </div>
          <small className="muted">
            {t("Timezone")}: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </small>
          {!meeting && hosts.length > 0 && (
            <Field label={t("Host")}>
              <select name="host" defaultValue={user?.id}>
                {hosts
                  .filter((h) => h.active)
                  .map((h) => (
                    <option value={h.id} key={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field label={t("Guest access")}>
            <select
              name="guest_policy"
              defaultValue={meeting?.guest_policy || brand.default_guest_policy}
            >
              <option value="invited">{t("Password-protected guests")}</option>
              <option value="disabled">{t("Employees only")}</option>
            </select>
          </Field>
          {(!meeting || repeat) && (
            <Field label={t("Invite by email")}>
              <textarea
                name="emails"
                placeholder={t("One email per line")}
                rows={2}
              />
            </Field>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              name="waiting"
              defaultChecked={meeting?.waiting_room ?? brand.waiting_room}
              disabled={brand.waiting_room}
            />
            {t("Waiting room")}
          </label>
          <div className="dialog-actions">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                {t("Cancel")}
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={busy}>
              {t(busy ? "Saving…" : "Save meeting")}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function Confirm({
  label,
  onConfirm,
  danger = true,
  description = "This action affects everyone in the meeting.",
  title,
  disabled = false,
  onPrepare,
  children,
}: {
  label: string;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  description?: string;
  title?: string;
  disabled?: boolean;
  onPrepare?: () => void;
  children?: ReactNode;
}) {
  const t = useText();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          if (value) onPrepare?.();
          setOpen(value);
          setError("");
        }
      }}
    >
      <Dialog.Trigger>
        <Button
          color={danger ? "red" : "green"}
          variant="soft"
          disabled={disabled}
        >
          {label}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="430px">
        <Dialog.Title>{title || t("Are you sure?")}</Dialog.Title>
        <Dialog.Description>{t(description)}</Dialog.Description>
        {children}
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy}>
              {t("Cancel")}
            </Button>
          </Dialog.Close>
          <Button
            color={danger ? "red" : "green"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t(busy ? "Working…" : "Confirm")}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function BulkDeleteMeetings({
  meetings,
  onDeleted,
}: {
  meetings: Meeting[];
  onDeleted: (ids: string[]) => void;
}) {
  const t = useText(),
    { notice } = useApp(),
    { lang } = useContext(Locale);
  const [snapshot, setSnapshot] = useState<Meeting[]>([]);
  return (
    <Confirm
      label={`${t("Delete selected")} (${meetings.length})`}
      disabled={!meetings.length}
      onPrepare={() => setSnapshot([...meetings])}
      title={`${t("Delete selected meetings")}: ${snapshot.length}`}
      description="Permanently delete the meetings listed below, including their invitations and attendance history? Active calls will end. This cannot be undone."
      onConfirm={async () => {
        const result = await api<{
          deleted_ids: string[];
          already_deleted_ids: string[];
          media_cleanup_pending: boolean;
        }>("/meetings/bulk-delete", "POST", {
          meeting_ids: snapshot.map((m) => m.id),
        });
        onDeleted([...result.deleted_ids, ...result.already_deleted_ids]);
        notice(
          `${t("Meetings deleted")}: ${result.deleted_ids.length}${result.media_cleanup_pending ? `. ${t("Disconnecting participants will retry automatically.")}` : ""}`,
        );
      }}
    >
      <ul className="delete-meeting-summary">
        {snapshot.map((m) => (
          <li key={m.id}>
            <strong>{m.title}</strong>
            <span>
              {timeFormat(m.starts, lang, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {t(m.status)}
            </span>
          </li>
        ))}
      </ul>
    </Confirm>
  );
}

function DeleteMeetingButton({
  meeting,
  onDeleted,
}: {
  meeting: Meeting;
  onDeleted: () => void | Promise<void>;
}) {
  const t = useText(),
    { notice } = useApp();
  return (
    <Confirm
      label={t("Delete meeting")}
      title={`${t("Delete meeting")}: ${meeting.title} · ${timeFormat(meeting.starts)}`}
      description="Permanently delete this meeting, its invitations and attendance history? Anyone in the meeting will be disconnected. This cannot be undone."
      onConfirm={async () => {
        let result;
        try {
          result = await api(`/meetings/${meeting.id}`, "DELETE");
        } catch (e) {
          if (!(e instanceof APIError) || e.status !== 404) throw e;
          await onDeleted();
          notice(
            t("This meeting was already deleted. The list has been updated."),
          );
          return;
        }
        notice(
          t(
            result.media_cleanup_pending
              ? "Meeting deleted. Disconnecting participants will retry automatically."
              : "Meeting deleted",
          ),
        );
        await onDeleted();
      }}
    />
  );
}

export function ManageDialog({
  meeting,
  close,
}: {
  meeting: Meeting;
  close: () => void;
}) {
  const t = useText();
  const [edit, setEdit] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Content maxWidth="700px">
        <Dialog.Title>{meeting.title}</Dialog.Title>
        <Dialog.Description>
          {t("Meeting details")} · {timeFormat(meeting.starts)} ·{" "}
          {meeting.timezone}
        </Dialog.Description>
        <ErrorBox error={error} />
        <div className="management-actions">
          <a
            className="text-link"
            href={`${base}/api/meetings/${meeting.id}/calendar`}
          >
            <CalendarDays size={16} />
            {t("Calendar")}
          </a>
          {
            <Button variant="soft" onClick={() => setEdit(true)}>
              {t(
                meeting.status === "scheduled"
                  ? "Reschedule meeting"
                  : "Schedule again",
              )}
            </Button>
          }
          <DeleteMeetingButton meeting={meeting} onDeleted={close} />
          {!["cancelled", "ended"].includes(meeting.status) && (
            <Confirm
              label={t("Cancel meeting")}
              onConfirm={() =>
                api(`/meetings/${meeting.id}/cancel`, "POST")
                  .then(close)
                  .catch((e) => setError(e.message))
              }
            />
          )}
        </div>
        <Invitations mid={meeting.id} />
        <div className="dialog-actions">
          <Button variant="soft" onClick={close}>
            {t("Close")}
          </Button>
        </div>
        <ScheduleDialog
          meeting={meeting}
          open={edit}
          setOpen={setEdit}
          onSave={close}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SettingsPage() {
  const { brand, refresh, notice } = useApp(),
    t = useText();
  const [draft, setDraft] = useState(brand),
    [section, setSection] = useState("Brand & identity"),
    [uploading, setUploading] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (key: keyof Branding, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/settings", "PUT", draft);
      await refresh();
      notice(t("Saved"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(
    file: File | undefined,
    key: "logo_url" | "favicon_url",
  ) {
    if (!file) return;
    setUploading((count) => count + 1);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await api("/admin/assets", "POST", form);
      set(key, r.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading((count) => count - 1);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("Workspace")}</span>
          <h1>{t("Settings")}</h1>
          <p>{t("Administrator controls for your workspace.")}</p>
        </div>
      </div>
      <nav className="settings-nav" aria-label={t("Settings sections")}>
        {[
          "Brand & identity",
          "Appearance templates",
          "People",
          "Security & policies",
          "My account",
        ].map((name) => (
          <button
            type="button"
            key={name}
            aria-current={section === name ? "page" : undefined}
            onClick={() => setSection(name)}
          >
            {t(name)}
          </button>
        ))}
      </nav>
      <form
        className="settings-form"
        onSubmit={save}
        hidden={section === "People" || section === "My account"}
      >
        <ErrorBox error={error} />
        <section
          className="settings-card"
          hidden={section !== "Brand & identity"}
        >
          <h2>{t("Brand & identity")}</h2>
          <div className="form-grid">
            <Field label={t("Application title")}>
              <input
                value={draft.application_title}
                onChange={(e) => set("application_title", e.target.value)}
                required
                maxLength={80}
              />
            </Field>
            <Field label={t("Application version")}>
              <input
                value={draft.application_version}
                aria-label={t("Application version")}
                onChange={(e) => set("application_version", e.target.value)}
                required
                maxLength={32}
              />
              <small>
                {t("Display label only; does not update the software.")}
              </small>
            </Field>
            <Field label={t("Company name")}>
              <input
                value={draft.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                required
                maxLength={80}
              />
            </Field>
            <Field label={t("Support email")}>
              <input
                type="email"
                value={draft.support_email}
                onChange={(e) => set("support_email", e.target.value)}
                required
              />
            </Field>
            <Field label={t("Primary color")}>
              <input
                type="color"
                value={draft.primary_color}
                onChange={(e) => set("primary_color", e.target.value)}
              />
            </Field>
            {(["logo_url", "favicon_url"] as const).map((key) => (
              <Field
                key={key}
                label={t(key === "logo_url" ? "Logo" : "Application icon")}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading > 0 || busy}
                  onChange={(e) => upload(e.target.files?.[0], key)}
                />
                {draft[key] && (
                  <img
                    className="asset-preview"
                    src={base + draft[key]}
                    alt={t(key === "logo_url" ? "Logo" : "Favicon")}
                  />
                )}
              </Field>
            ))}
          </div>
          <p className="muted">
            {t(
              "PNG, JPEG or WebP. Maximum 2 MB and 4 megapixels. Save to apply uploads.",
            )}
          </p>
          <div className="inline-buttons">
            <Button
              type="button"
              variant="soft"
              disabled={!draft.logo_url || uploading > 0}
              onClick={() => set("logo_url", "")}
            >
              {t("Remove logo")}
            </Button>
            <Button
              type="button"
              variant="soft"
              disabled={!draft.favicon_url || uploading > 0}
              onClick={() => set("favicon_url", "")}
            >
              {t("Remove icon")}
            </Button>
          </div>
        </section>
        <section
          className="settings-card"
          hidden={section !== "Appearance templates"}
        >
          <h2>{t("Appearance templates")}</h2>
          <p className="muted">
            {t(
              "Choose a workspace layout. Save changes to apply it for everyone.",
            )}
          </p>
          <div className="template-options">
            {(
              [
                [
                  "garden",
                  "Garden",
                  "Soft green surfaces and a welcoming meeting dashboard.",
                ],
                [
                  "studio",
                  "Studio",
                  "Neutral surfaces, crisp edges and a focused workspace.",
                ],
                [
                  "compact",
                  "Compact",
                  "Smaller spacing and a streamlined dashboard.",
                ],
              ] as const
            ).map(([value, label, description]) => (
              <label className="template-option" key={value}>
                <div
                  className={`template-preview preview-${value}`}
                  aria-hidden="true"
                >
                  <i />
                  <div>
                    <b />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <div>
                  <input
                    type="radio"
                    name="appearance-template"
                    value={value}
                    checked={draft.appearance_template === value}
                    onChange={() => set("appearance_template", value)}
                  />
                  <strong>{t(label)}</strong>
                </div>
                <p>{t(description)}</p>
              </label>
            ))}
          </div>
        </section>
        <section
          className="settings-card"
          hidden={section !== "Security & policies"}
        >
          <h2>{t("Security & policies")}</h2>
          <Field label={t("Default duration (minutes)")}>
            <input
              type="number"
              min={15}
              max={480}
              value={draft.default_duration}
              onChange={(e) => set("default_duration", +e.target.value)}
            />
          </Field>
          <Field label={t("Guest access")}>
            <select
              value={draft.default_guest_policy}
              onChange={(e) => set("default_guest_policy", e.target.value)}
            >
              <option value="invited">{t("Password-protected guests")}</option>
              <option value="disabled">{t("Employees only")}</option>
            </select>
          </Field>
          {(
            [
              ["employees_can_create", "Allow employee meeting creation"],
              ["external_guests", "Allow external guests"],
              ["waiting_room", "Require waiting room"],
            ] as const
          ).map(([key, label]) => (
            <label className="switch-row" key={key}>
              {t(label)}
              <Switch
                checked={draft[key]}
                onCheckedChange={(v) => set(key, v)}
              />
            </label>
          ))}
          <div className="policy-note">
            <ShieldCheck size={18} />
            <div>
              <strong>{t("Recording")}</strong>
              <p>{t("Disabled — private unrecorded meetings")}</p>
            </div>
          </div>
        </section>
        <section
          className="settings-card"
          hidden={section !== "Security & policies"}
        >
          <h2>{t("Notifications")}</h2>
          {(
            [
              ["email_enabled", "Enable email invitations"],
              ["reminders_enabled", "Enable reminders"],
            ] as const
          ).map(([key, label]) => (
            <label className="switch-row" key={key}>
              {t(label)}
              <Switch
                checked={draft[key]}
                onCheckedChange={(v) => set(key, v)}
              />
            </label>
          ))}
          <Field label={t("Reminder lead time (minutes)")}>
            <input
              type="number"
              min={5}
              max={1440}
              value={draft.reminder_minutes}
              onChange={(e) => set("reminder_minutes", +e.target.value)}
            />
          </Field>
        </section>
        <Button size="3" disabled={busy || uploading > 0}>
          {t(uploading > 0 ? "Uploading…" : busy ? "Saving…" : "Save changes")}
        </Button>
      </form>
      {section === "People" && <People />}
      {section === "My account" && (
        <>
          <AccountEmail />
          <AccountPassword />
        </>
      )}
      {section === "Security & policies" && <AuditLog />}
    </>
  );
}

function AccountEmail() {
  const { user, refresh, notice } = useApp(),
    t = useText();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setError("");
    setBusy(true);
    try {
      await api("/admin/account/email", "POST", {
        email: data.get("email"),
        current_password: data.get("current_password"),
      });
      form.reset();
      await refresh();
      notice(
        t(
          "Email changed. Sign in with your new email and your existing password. All previous sessions are signed out.",
        ),
      );
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="settings-form settings-card"
      aria-label={t("Change my email")}
      onSubmit={change}
    >
      <h2>{t("Change my email")}</h2>
      <p className="muted">
        {t("Current sign-in email")}: <bdi>{user?.email}</bdi>
      </p>
      <p>
        {t(
          "Your email is your username. Changing it signs out all your sessions. Your password and hosted meetings stay the same.",
        )}
      </p>
      <ErrorBox error={error} />
      <Field label={t("New email address")}>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </Field>
      <input
        name="username"
        type="hidden"
        autoComplete="username"
        value={user?.email || ""}
      />
      <Field label={t("Current password")}>
        <input
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </Field>
      <Button type="submit" disabled={busy}>
        {t(busy ? "Saving…" : "Change my email")}
      </Button>
    </form>
  );
}

function AccountPassword() {
  const { user, refresh, notice } = useApp(),
    t = useText();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setError("");
    if (data.get("password") !== data.get("confirm_password")) {
      setError(t("New passwords do not match."));
      return;
    }
    setBusy(true);
    try {
      await api("/admin/account/password", "POST", {
        current_password: data.get("current_password"),
        password: data.get("password"),
      });
      form.reset();
      await refresh();
      notice(
        t(
          "Password changed. Sign in with your new password. All previous sessions are signed out.",
        ),
      );
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="settings-form settings-card"
      aria-label={t("Change my password")}
      onSubmit={change}
    >
      <h2>{t("Change my password")}</h2>
      <p className="muted">{user?.email}</p>
      <p>
        {t(
          "Use at least 12 characters. Changing your password signs out all your sessions.",
        )}
      </p>
      <ErrorBox error={error} />
      <input
        type="hidden"
        name="username"
        autoComplete="username"
        value={user?.email || ""}
      />
      <Field label={t("Current password")}>
        <input
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </Field>
      <Field label={t("New password")}>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </Field>
      <Field label={t("Confirm new password")}>
        <input
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </Field>
      <Button type="submit" disabled={busy}>
        {t(busy ? "Saving…" : "Change my password")}
      </Button>
    </form>
  );
}

function People() {
  const t = useText(),
    { user, notice } = useApp();
  const [people, setPeople] = useState<User[]>([]),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [reset, setReset] = useState<User | null>(null);
  const load = () =>
    api<User[]>("/admin/users")
      .then(setPeople)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api(
        "/admin/users",
        "POST",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      setOpen(false);
      load();
      notice(t("Saved"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("Team directory")}</span>
          <h1>{t("People")}</h1>
          <p>{t("Manage the people who bring your workspace to life.")}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} />
          {t("Add user")}
        </Button>
      </div>
      <ErrorBox error={error} />
      <div className="people-list">
        {people.map((p) => (
          <article key={p.id}>
            <span className="avatar">{p.name[0]}</span>
            <div>
              <strong>{p.name}</strong>
              <small>{p.email}</small>
            </div>
            <Badge color={p.active ? "green" : "gray"}>
              {t(p.role)} · {t(p.active ? "active" : "Disable")}
            </Badge>
            <div className="inline-buttons">
              {p.id !== user?.id && (
                <Button variant="ghost" onClick={() => setReset(p)}>
                  {t("Reset password")}
                </Button>
              )}
              {p.id !== user?.id && (
                <Button
                  variant="soft"
                  color={p.active ? "red" : "green"}
                  onClick={() =>
                    api(`/admin/users/${p.id}`, "PATCH", { active: !p.active })
                      .then(load)
                      .catch((e) => setError(e.message))
                  }
                >
                  {t(p.active ? "Disable" : "Enable")}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>{t("Add user")}</Dialog.Title>
          <Dialog.Description>
            {t("Use your company account to continue.")}
          </Dialog.Description>
          <form className="dialog-form" onSubmit={create}>
            <ErrorBox error={error} />
            <Field label={t("Name")}>
              <input name="name" required maxLength={80} />
            </Field>
            <Field label={t("Email address")}>
              <input name="email" type="email" required />
            </Field>
            <Field label={t("Password")}>
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label={t("Role")}>
              <select name="role" aria-label={t("Role")}>
                <option value="employee">{t("employee")}</option>
                <option value="admin">{t("admin")}</option>
              </select>
            </Field>
            <div className="dialog-actions">
              <Dialog.Close>
                <Button type="button" variant="soft">
                  {t("Cancel")}
                </Button>
              </Dialog.Close>
              <Button>{t("Create user")}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={!!reset} onOpenChange={(o) => !o && setReset(null)}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>{t("Reset password")}</Dialog.Title>
          <Dialog.Description>{reset?.email}</Dialog.Description>
          <form
            className="dialog-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/admin/users/${reset?.id}/password`, "POST", {
                  password: new FormData(e.currentTarget).get("password"),
                });
                setReset(null);
                notice(t("Saved"));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label={t("New password")}>
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
            <Button>{t("Save changes")}</Button>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
function AuditLog() {
  const t = useText();
  const [events, setEvents] = useState<any[]>([]),
    [error, setError] = useState("");
  return (
    <section className="settings-card audit">
      <div className="section-title">
        <h2>{t("Audit log")}</h2>
        <Button
          variant="soft"
          onClick={() =>
            api<any[]>("/admin/audit")
              .then(setEvents)
              .catch((e) => setError(e.message))
          }
        >
          {t("Refresh")}
        </Button>
      </div>
      <ErrorBox error={error} />
      {events.map((e, i) => (
        <div className="audit-row" key={i}>
          <time>{timeFormat(e.at)}</time>
          <code>{e.action}</code>
          <span title={e.target}>{e.target.slice(0, 12)}</span>
        </div>
      ))}
    </section>
  );
}
