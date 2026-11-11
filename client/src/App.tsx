import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bolt,
  Braces,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Crown,
  Eye,
  EyeOff,
  Fingerprint,
  Gauge,
  LockKeyhole,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Timer,
  Trophy,
  Trash2,
  Users,
  Wifi,
  X
} from "lucide-react";
import { api } from "./api";
import type {
  ParticipantInfo,
  RoomDetail,
  RoomState,
  RoomSummary,
  RoundNumber,
  ScoreInfo
} from "./types";

type AppMode = "home" | "participant" | "organiser" | "challenge";
type ChallengeDraft = { round: RoundNumber; referenceText: string; duration: number };
const DEFAULT_DURATIONS: Record<RoundNumber, number> = { 1: 30, 2: 45, 3: 60 };
const ROUND_NAMES: Record<RoundNumber, string> = {
  1: "Type Before Time Runs Out",
  2: "Blind Code Master",
  3: "Decode, Type & Win"
};
const ROUND_POINTS: Record<RoundNumber, number> = { 1: 10, 2: 20, 3: 30 };

function getSocket(token?: string): Socket {
  return io({ auth: token ? { role: "admin", token } : { role: "participant" } });
}

function App() {
  const [mode, setMode] = useState<AppMode>("home");
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<ChallengeDraft[]>([]);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("bcc-admin-token") ?? "");
  const [roomState, setRoomState] = useState<RoomState>();
  const [activeRole, setActiveRole] = useState<"participant" | "admin">("participant");
  const [activeRoomCode, setActiveRoomCode] = useState("");
  const [activeRoomName, setActiveRoomName] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [socket, setSocket] = useState<Socket>();
  const [joinedParticipantId, setJoinedParticipantId] = useState("");

  useEffect(() => {
    api<ChallengeDraft[]>("/api/challenges")
      .then(setTemplates)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load challenges."));
  }, []);

  useEffect(() => {
    if (mode !== "challenge" || !activeRoomCode) return;
    const connection = getSocket(activeRole === "admin" ? adminToken : undefined);
    setSocket(connection);
    connection.on("connect", () => {
      if (activeRole === "admin") {
        connection.emit("join-admin", { code: activeRoomCode });
      } else {
        connection.emit("join-participant", {
          code: activeRoomCode,
          name: localStorage.getItem(`bcc-name-${activeRoomCode}`) ?? "Participant",
          usn: localStorage.getItem(`bcc-usn-${activeRoomCode}`) ?? "",
          participantId: localStorage.getItem(`bcc-participant-${activeRoomCode}`) ?? undefined
        });
      }
    });
    connection.on("room-state", (state: RoomState) => setRoomState(state));
    connection.on("action-error", (payload: { message?: string }) => {
      setError(payload.message ?? "Room action failed.");
    });
    connection.on("connect_error", (cause: Error) => setError(cause.message));
    connection.on("joined", (payload: { participantId: string }) => {
      setJoinedParticipantId(payload.participantId);
      localStorage.setItem(`bcc-participant-${activeRoomCode}`, payload.participantId);
    });
    return () => {
      connection.disconnect();
      setSocket(undefined);
    };
  }, [activeRole, activeRoomCode, adminToken, mode]);

  const refreshRooms = useCallback(async () => {
    if (!adminToken) return;
    try {
      setRooms(await api<RoomSummary[]>("/api/admin/rooms", {}, adminToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load rooms.");
    }
  }, [adminToken]);

  useEffect(() => {
    if (mode === "organiser" && adminToken) void refreshRooms();
  }, [adminToken, mode, refreshRooms]);

  const enterRoom = (code: string, name: string, usn: string, role: "participant" | "admin") => {
    setError("");
    setRoomState(undefined);
    setActiveRole(role);
    setActiveRoomCode(code.toUpperCase());
    setActiveRoomName(role === "participant" ? localStorage.getItem(`bcc-name-${code.toUpperCase()}`) ?? name : name);
    setJoinedParticipantId("");
    setMode("challenge");
    if (role === "participant") {
      localStorage.setItem(`bcc-name-${code.toUpperCase()}`, name);
      localStorage.setItem(`bcc-usn-${code.toUpperCase()}`, usn.toUpperCase());
    }
  };

  const leaveRoom = () => {
    socket?.disconnect();
    setSocket(undefined);
    setRoomState(undefined);
    setActiveRoomCode("");
    setMode(adminToken ? "organiser" : "home");
  };

  const signOut = () => {
    localStorage.removeItem("bcc-admin-token");
    setAdminToken("");
    setRooms([]);
    setMode("home");
    setError("");
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-cyan" />
      <div className="ambient ambient-orange" />
      <Header
        mode={mode}
        admin={Boolean(adminToken)}
        onHome={() => { setError(""); setMode("home"); }}
        onSignOut={signOut}
      />
      {error && (
        <div className="global-error" role="alert">
          <X size={15} /> {error}
          <button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      <main>
        {mode === "home" && (
          <Home onParticipant={() => setMode("participant")} onOrganiser={() => setMode("organiser")} />
        )}
        {mode === "participant" && (
          <JoinParticipant onBack={() => setMode("home")} onJoin={(code, name, usn) => enterRoom(code, name, usn, "participant")} />
        )}
        {mode === "organiser" && (
          <Organiser
            token={adminToken}
            rooms={rooms}
            templates={templates}
            onToken={(token) => {
              localStorage.setItem("bcc-admin-token", token);
              setAdminToken(token);
            }}
            onRefresh={refreshRooms}
            onJoin={(code, name) => enterRoom(code, name, "", "admin")}
            onCreated={(room) => setRooms((current) => [room, ...current])}
            onClearError={() => setError("")}
            onError={setError}
          />
        )}
        {mode === "challenge" && (
          <ChallengeRoom
            state={roomState}
            roomCode={activeRoomCode}
            roomName={activeRoomName}
            isAdmin={activeRole === "admin"}
            socket={socket}
            participantId={joinedParticipantId}
            token={adminToken}
            onLeave={leaveRoom}
            onError={setError}
            onRoomsChanged={refreshRooms}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Header({
  mode,
  admin,
  onHome,
  onSignOut
}: {
  mode: AppMode;
  admin: boolean;
  onHome: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} aria-label="Go to home">
        <span className="brand-mark"><Braces size={18} strokeWidth={2.2} /></span>
        <span className="brand-copy">SIGNAL<span className="brand-slash">/</span>NOISE<small>BLIND CODING CHALLENGE</small></span>
      </button>
      <div className="topbar-right">
        <span className="event-status"><span className="status-dot" /> SYSTEM ONLINE</span>
        {admin && mode === "organiser" && (
          <button type="button" className="quiet-button" onClick={onSignOut}><LogOut size={14} /> SIGN OUT</button>
        )}
        <div className="fest-tag">TECH FEST <span>LIVE</span></div>
      </div>
    </header>
  );
}

function Home({ onParticipant, onOrganiser }: { onParticipant: () => void; onOrganiser: () => void }) {
  return (
    <section className="hero page-width">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-line" /> A DIFFERENT KIND OF CODE JAM <ArrowUpRight size={14} /></div>
        <h1>Trust your<br /><span>muscle memory.</span></h1>
        <p className="hero-subtitle">See the code. Then look away. Type it perfectly before the clock runs out.</p>
        <div className="hero-actions">
          <button className="button button-primary" type="button" onClick={onParticipant}>ENTER THE ARENA <ArrowRight size={16} /></button>
          <button className="button button-secondary" type="button" onClick={onOrganiser}><LockKeyhole size={15} /> ORGANISER ACCESS</button>
        </div>
        <div className="hero-facts">
          <div><strong>03</strong><span>ROUNDS</span></div>
          <i />
          <div><strong>60<span className="fact-unit">PTS</span></strong><span>UP FOR GRABS</span></div>
          <i />
          <div><strong>01</strong><span>CHAMPION</span></div>
        </div>
      </div>
      <div className="hero-visual">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="crosshair crosshair-a" />
        <div className="crosshair crosshair-b" />
        <div className="hero-code-card">
          <div className="code-card-head"><span className="window-lights"><i /><i /><i /></span><span>challenge.ts</span><span className="code-lock"><EyeOff size={13} /> HIDDEN INPUT</span></div>
          <div className="code-lines">
            <p><span>01</span> <b className="syntax-purple">const</b> <b className="syntax-cyan">focus</b> = <em>true</em>;</p>
            <p><span>02</span> <b className="syntax-purple">while</b> (clock.isRunning) {'{'}</p>
            <p><span>03</span> &nbsp;&nbsp;type(<b className="syntax-lime">"without looking"</b>);</p>
            <p><span>04</span> {'}'}</p>
            <p className="code-cursor-row"><span>05</span> <i className="cursor-block" /></p>
          </div>
          <div className="mask-callout"><span className="callout-line" /><EyeOff size={13} /><span>YOUR TYPING STAYS INVISIBLE</span><ArrowDownRight size={14} /></div>
        </div>
        <div className="floating-chip chip-one"><Timer size={14} /> 00:45 <span>REMAINING</span></div>
        <div className="floating-chip chip-two"><ShieldCheck size={14} /> SERVER TIMED <span>ANTI-CHEAT ON</span></div>
        <div className="visual-caption">FIG 01. / THE BLIND TYPING INTERFACE <span>● LIVE</span></div>
      </div>
      <div className="feature-strip">
        <Feature icon={<EyeOff size={17} />} label="NO PEEKING" detail="Masked input, always" />
        <Feature icon={<Gauge size={17} />} label="PRECISION FIRST" detail="Accuracy decides it" />
        <Feature icon={<Radio size={17} />} label="LIVE ARENA" detail="Scores update in real time" />
        <Feature icon={<Fingerprint size={17} />} label="FAIR PLAY" detail="Clock runs server-side" />
      </div>
    </section>
  );
}

function Feature({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return <div className="feature-item"><span className="feature-icon">{icon}</span><span><b>{label}</b><small>{detail}</small></span></div>;
}

function JoinParticipant({
  onBack,
  onJoin
}: {
  onBack: () => void;
  onJoin: (code: string, name: string, usn: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [usn, setUsn] = useState("");
  return (
    <section className="narrow-page">
      <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={14} /> BACK TO BRIEFING</button>
      <div className="form-panel panel">
        <div className="panel-overline"><span className="status-dot" /> PARTICIPANT ENTRY</div>
        <h2>Find your<br /><span>room.</span></h2>
        <p className="form-intro">Enter the code shared by your organiser. One person, one shot at the leaderboard.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (code.trim().length === 6 && name.trim() && usn.trim()) onJoin(code.trim(), name.trim(), usn.trim());
        }}>
          <label htmlFor="room-code">ROOM CODE</label>
          <input id="room-code" className="text-input room-code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="A B C 1 2 3" maxLength={6} required autoComplete="off" />
          <label htmlFor="player-name">YOUR CALLSIGN</label>
          <input id="player-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" maxLength={40} required autoComplete="nickname" />
          <label htmlFor="player-usn">USN</label>
          <input id="player-usn" className="text-input usn-input" value={usn} onChange={(event) => setUsn(event.target.value.toUpperCase().replace(/[^A-Z0-9._/-]/g, "").slice(0, 32))} placeholder="e.g. 1BI23CS001" maxLength={32} required autoComplete="off" />
          <button className="button button-primary button-wide" type="submit" disabled={code.length !== 6 || !name.trim() || usn.trim().length < 3}>JOIN THE ARENA <ArrowRight size={16} /></button>
        </form>
        <p className="form-footnote"><Shield size={13} /> Your USN is visible to organisers only and saved with this event.</p>
      </div>
    </section>
  );
}

function Organiser({
  token,
  rooms,
  templates,
  onToken,
  onRefresh,
  onJoin,
  onCreated,
  onClearError,
  onError
}: {
  token: string;
  rooms: RoomSummary[];
  templates: ChallengeDraft[];
  onToken: (token: string) => void;
  onRefresh: () => void;
  onJoin: (code: string, name: string) => void;
  onCreated: (room: RoomSummary) => void;
  onClearError: () => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [roomName, setRoomName] = useState("Blind Coding Arena");
  const [challenges, setChallenges] = useState<ChallengeDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [eventDetail, setEventDetail] = useState<RoomDetail>();
  const [expandedEventCode, setExpandedEventCode] = useState("");
  const [editingEventCode, setEditingEventCode] = useState("");
  const [editingEventName, setEditingEventName] = useState("");
  const [eventBusy, setEventBusy] = useState(false);

  useEffect(() => {
    setChallenges(templates.map((challenge) => ({
      ...challenge,
      duration: challenge.duration ?? DEFAULT_DURATIONS[challenge.round]
    })));
  }, [templates]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    onClearError();
    setBusy(true);
    try {
      const result = await api<{ token: string }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      onToken(result.token);
      setPassword("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Organiser sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    onClearError();
    try {
      const room = await api<RoomSummary>("/api/admin/rooms", {
        method: "POST",
        body: JSON.stringify({ name: roomName, challenges })
      }, token);
      onCreated(room);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Room could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      onError("Clipboard permission was denied.");
    }
  };

  const toggleEventDetails = async (code: string) => {
    if (expandedEventCode === code) {
      setExpandedEventCode("");
      setEventDetail(undefined);
      setEditingEventCode("");
      return;
    }
    setEventBusy(true);
    setExpandedEventCode(code);
    setEditingEventCode("");
    try {
      const details = await api<RoomDetail>(`/api/admin/rooms/${code}`, {}, token);
      setEventDetail(details);
      setEditingEventName(details.room.name);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not load event details.");
    } finally {
      setEventBusy(false);
    }
  };

  const saveEventName = async (code: string) => {
    setEventBusy(true);
    try {
      await api(`/api/admin/rooms/${code}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editingEventName })
      }, token);
      void onRefresh();
      setEventDetail((current) => current
        ? { ...current, room: { ...current.room, name: editingEventName.trim() } }
        : current);
      setEditingEventCode("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update event name.");
    } finally {
      setEventBusy(false);
    }
  };

  const removeEvent = async (code: string, name: string) => {
    if (!window.confirm(`Permanently delete "${name}" and all of its participants and scores? This cannot be undone.`)) return;
    setEventBusy(true);
    try {
      await api(`/api/admin/rooms/${code}`, { method: "DELETE" }, token);
      void onRefresh();
      setExpandedEventCode("");
      setEventDetail(undefined);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not delete event.");
    } finally {
      setEventBusy(false);
    }
  };

  if (!token) {
    return (
      <section className="narrow-page">
        <div className="form-panel panel">
          <div className="panel-overline"><LockKeyhole size={14} /> ORGANISER CONSOLE</div>
          <h2>Run the<br /><span>show.</span></h2>
          <p className="form-intro">Sign in to create challenge rooms, control the round clock and track the live scoreboard.</p>
          <form onSubmit={signIn}>
            <label htmlFor="organiser-password">ACCESS PASSWORD</label>
            <input id="organiser-password" className="text-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your organiser password" autoComplete="current-password" required />
            <button type="submit" className="button button-primary button-wide" disabled={busy}>{busy ? "VERIFYING…" : "OPEN CONSOLE"} <ArrowRight size={16} /></button>
          </form>
          <p className="form-footnote"><ShieldCheck size={13} /> Protected organiser access · token expires after 8 hours</p>
        </div>
      </section>
    );
  }

  return (
    <section className="organiser-page page-width">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-line" /> CONTROL ROOM</div><h1>Make some <span>noise.</span></h1></div>
        <button type="button" className="button button-secondary" onClick={onRefresh}><RefreshCw size={14} /> REFRESH ROOMS</button>
      </div>
      <div className="organiser-grid">
        <form className="panel create-panel" onSubmit={createRoom}>
          <div className="panel-title-row"><div><div className="panel-overline"><Plus size={14} /> NEW ROOM</div><h3>Set the challenge.</h3></div><span className="panel-index">01 / 02</span></div>
          <label htmlFor="arena-name">ROOM NAME</label>
          <input id="arena-name" className="text-input" value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={60} required />
          <div className="challenge-editor-heading"><label>REFERENCE SNIPPETS <span>— EXACT SPACES COUNT</span></label><span className="saved-badge"><Check size={11} /> {challenges.length}/3 LOADED</span></div>
          {([1, 2, 3] as RoundNumber[]).map((round) => (
            <div className="round-editor" key={round}>
              <div className={`round-number round-${round}`}>0{round}</div>
              <div className="round-editor-content">
                <div className="round-editor-title"><b>{ROUND_NAMES[round]}</b><span>{ROUND_POINTS[round]} PTS</span></div>
                <label className="duration-editor" htmlFor={`round-${round}-duration`}>
                  <Clock3 size={13} /> TIME LIMIT
                  <input
                    id={`round-${round}-duration`}
                    aria-label={`Round ${round} time limit in seconds`}
                    type="number"
                    min={5}
                    max={3600}
                    step={1}
                    value={challenges.find((entry) => entry.round === round)?.duration ?? DEFAULT_DURATIONS[round]}
                    onChange={(event) => setChallenges((current) => current.map((entry) =>
                      entry.round === round ? { ...entry, duration: Number(event.target.value) } : entry
                    ))}
                    required
                  />
                  <span>SECONDS</span>
                </label>
                <textarea
                  aria-label={`Round ${round} reference code`}
                  value={challenges.find((entry) => entry.round === round)?.referenceText ?? ""}
                  onChange={(event) => setChallenges((current) => current.map((entry) =>
                    entry.round === round ? { ...entry, referenceText: event.target.value } : entry
                  ))}
                  rows={4}
                  maxLength={10_000}
                  required
                  spellCheck={false}
                />
              </div>
            </div>
          ))}
          <button type="submit" className="button button-primary button-wide" disabled={busy || challenges.length !== 3}>{busy ? "CREATING ROOM…" : "CREATE ROOM"} <ArrowRight size={15} /></button>
          <div className="form-footnote"><ShieldCheck size={13} /> Scores use exact character accuracy. Speed gives no bonus points.</div>
        </form>
        <div className="panel rooms-panel">
          <div className="panel-title-row"><div><div className="panel-overline"><Radio size={14} /> ARENA STATUS</div><h3>Your rooms.</h3></div><span className="live-count"><i /> {rooms.length} TOTAL</span></div>
          {rooms.length === 0 ? (
            <div className="empty-rooms"><div className="empty-icon"><Terminal size={20} /></div><b>No rooms in play.</b><span>Create your first arena to get started.</span></div>
          ) : (
            <div className="room-list">
              {rooms.filter((room) => room.status !== "completed").length > 0 && (
                <div className="room-section-heading"><Radio size={13} /> ACTIVE ROOMS</div>
              )}
              {rooms.filter((room) => room.status !== "completed").map((room) => (
                <div className="room-row" key={room.code}>
                  <div className="room-card-top"><span className={`room-state state-${room.status}`}>{room.status.replace("_", " ")}</span><span className="room-round-label">ROUND {room.round} / 3</span></div>
                  <h4>{room.name}</h4>
                  <div className="room-meta"><span><Users size={13} /> {room.participants} players</span><span><Trophy size={13} /> {Number(room.totalPoints).toFixed(1)} pts</span></div>
                  <div className="room-card-actions">
                    <button className="room-code-button" type="button" onClick={() => void copyCode(room.code)} aria-label="Copy room code"><code>{room.code}</code>{copied === room.code ? <Check size={13} /> : <Copy size={13} />}</button>
                    <button className="open-room-link" type="button" onClick={() => onJoin(room.code, room.name)}>OPEN CONSOLE <ArrowRight size={13} /></button>
                  </div>
                </div>
              ))}
              {rooms.filter((room) => room.status === "completed").length > 0 && (
                <div className="room-section-heading completed-heading"><Trophy size={13} /> COMPLETED EVENTS</div>
              )}
              {rooms.filter((room) => room.status === "completed").map((room) => (
                <div className="room-row completed-event-row" key={room.code}>
                  <div className="room-card-top"><span className="room-state state-completed">completed</span><span className="room-round-label">3 ROUNDS / {new Date(room.createdAt).toLocaleDateString()}</span></div>
                  {editingEventCode === room.code ? (
                    <div className="event-name-edit">
                      <input className="text-input" aria-label="Edit event name" value={editingEventName} maxLength={60} onChange={(event) => setEditingEventName(event.target.value)} />
                      <button type="button" className="button button-primary" disabled={eventBusy || editingEventName.trim().length < 2} onClick={() => void saveEventName(room.code)}><Check size={14} /> SAVE</button>
                      <button type="button" className="button button-secondary" onClick={() => { setEditingEventCode(""); setEditingEventName(room.name); }}>CANCEL</button>
                    </div>
                  ) : <h4>{room.name}</h4>}
                  <div className="room-meta"><span><Users size={13} /> {room.participants} participants</span><span><Trophy size={13} /> {Number(room.totalPoints).toFixed(1)} pts total</span></div>
                  <div className="room-card-actions">
                    <button className="open-room-link" type="button" onClick={() => void toggleEventDetails(room.code)}><Eye size={14} /> {expandedEventCode === room.code ? "HIDE DETAILS" : "VIEW EVENT"} <ArrowRight size={13} /></button>
                    <span className="completed-actions">
                      <button type="button" className="icon-action" aria-label="Rename event" disabled={eventBusy} onClick={() => { setEditingEventCode(room.code); setEditingEventName(room.name); }}><Pencil size={14} /></button>
                      <button type="button" className="icon-action icon-action-danger" aria-label="Delete event" disabled={eventBusy} onClick={() => void removeEvent(room.code, room.name)}><Trash2 size={14} /></button>
                    </span>
                  </div>
                  {expandedEventCode === room.code && (
                    <EventDetails
                      detail={eventDetail?.room.code === room.code ? eventDetail : undefined}
                      loading={eventBusy && eventDetail?.room.code !== room.code}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="room-panel-foot"><span><Wifi size={13} /> REAL-TIME SYNC ACTIVE</span><span>1 PLAYER = 1 TEAM</span></div>
        </div>
      </div>
    </section>
  );
}

function EventDetails({ detail, loading }: { detail?: RoomDetail; loading: boolean }) {
  if (loading || !detail) {
    return <div className="event-details event-details-loading">{loading ? "LOADING EVENT RESULTS…" : "EVENT DETAILS UNAVAILABLE."}</div>;
  }
  const leaderboard = detail.participants.map((participant) => {
    const scores = detail.scores.filter((score) => score.participantId === participant.id);
    return {
      ...participant,
      scores,
      total: scores.reduce((sum, score) => sum + score.points, 0)
    };
  }).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));

  return (
    <div className="event-details">
      <div className="event-details-rounds">
        {detail.challenges.map((challenge) => (
          <span key={challenge.round}>ROUND {challenge.round}: {challenge.duration}s</span>
        ))}
      </div>
      {leaderboard.length === 0 ? <p className="event-empty-results">No participants registered for this event.</p> : (
        <div className="event-results">
          <div className="event-results-head"><span>PARTICIPANT / USN</span><span>R1 · R2 · R3 / TOTAL</span></div>
          {leaderboard.map((participant, index) => (
            <div className="event-result-row" key={participant.id}>
              <span className="event-participant"><b>{String(index + 1).padStart(2, "0")} · {participant.name}</b><small>{participant.usn}</small></span>
              <span className="event-participant-scores">
                {([1, 2, 3] as RoundNumber[]).map((round) => (
                  <span key={round}>{participant.scores.find((score) => score.round === round)?.points.toFixed(1) ?? "—"}</span>
                ))}
                <b>{participant.total.toFixed(1)}</b>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChallengeRoom({
  state,
  roomCode,
  roomName,
  isAdmin,
  socket,
  participantId,
  token,
  onLeave,
  onError,
  onRoomsChanged
}: {
  state?: RoomState;
  roomCode: string;
  roomName: string;
  isAdmin: boolean;
  socket?: Socket;
  participantId: string;
  token: string;
  onLeave: () => void;
  onError: (message: string) => void;
  onRoomsChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [timeNow, setTimeNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!state) return;
    setServerOffset(state.serverTime - Date.now());
    if (state.status !== "running") setDraft("");
  }, [state?.serverTime, state?.status, state?.round]);

  useEffect(() => {
    const interval = window.setInterval(() => setTimeNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = state
    ? state.status === "running"
      ? Math.max(0, state.remainingMs - (timeNow + serverOffset - state.serverTime))
      : state.remainingMs
    : 0;
  const challenge = state?.challenge;
  const participant = state?.participants.find((entry) => entry.id === participantId);
  const ownRoundScore = state?.scores.find((score) => score.participantId === participantId && score.round === state.round);

  useEffect(() => {
    if (!isAdmin && state?.status === "running" && socket) {
      socket.emit("participant-draft", { text: draft });
    }
  }, [draft, isAdmin, socket, state?.status]);

  const act = async (action: "start" | "pause" | "end") => {
    setBusy(true);
    try {
      await api(`/api/admin/rooms/${roomCode}/${action}`, { method: "POST" }, token);
      onRoomsChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update round.");
    } finally {
      setBusy(false);
    }
  };

  const onForbiddenInput = (event: React.SyntheticEvent) => event.preventDefault();
  const maskedDraft = draft.replace(/[^\n\r]/g, "•");
  const formattedRemaining = `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;
  const progress = challenge ? Math.max(0, Math.min(100, (remaining / (challenge.duration * 1000)) * 100)) : 0;

  return (
    <section className="arena-page page-width">
      <div className="arena-heading">
        <button className="back-link" type="button" onClick={onLeave}><ArrowLeft size={14} /> {isAdmin ? "ALL ROOMS" : "LEAVE ARENA"}</button>
        <div className="arena-room-id"><span className="status-dot" /> {isAdmin ? "ORGANISER CONSOLE" : "LIVE ARENA"} <b>{roomCode}</b></div>
      </div>
      {!state ? (
        <div className="waiting-connection panel"><div className="spinner" /><b>Connecting to {roomName}…</b><span>Syncing with the room server</span></div>
      ) : (
        <>
          <div className="arena-title-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> {roomName.toUpperCase()}</div><h1>{isAdmin ? "The control deck." : <>Eyes up.<br /><span>Hands ready.</span></>}</h1></div>
            <div className="round-progress">
              {([1, 2, 3] as RoundNumber[]).map((round) => (
                <span key={round} className={`${round === state.round ? "current" : ""} ${round < state.round || state.status === "completed" ? "done" : ""}`}><i>0{round}</i><b>{ROUND_NAMES[round]}</b></span>
              ))}
            </div>
          </div>
          {state.status === "lobby" ? (
            isAdmin
              ? <OrganiserLobby state={state} onAct={act} busy={busy} />
              : <ParticipantLobby state={state} name={participant?.name ?? "Participant"} />
          ) : (
            <>
              <div className="arena-grid">
                <div className="challenge-column">
                  <div className="challenge-meta">
                    <div className="round-pill">ROUND 0{state.round} <span>·</span> {ROUND_POINTS[state.round]} PTS</div>
                    <div className="challenge-title">{ROUND_NAMES[state.round]} <span>· {challenge?.duration ?? DEFAULT_DURATIONS[state.round]} SECONDS</span></div>
                  </div>
                  <div className={`clock-panel ${remaining <= 10_000 && state.status === "running" ? "clock-urgent" : ""}`}>
                    <div className="clock-label"><Timer size={14} /> SERVER CLOCK <span>{state.status === "running" ? "RUNNING" : state.status === "paused" ? "PAUSED" : state.status === "completed" ? "FINAL" : "LOCKED"}</span></div>
                    <strong>{formattedRemaining}</strong>
                    <div className="clock-track"><i style={{ width: `${progress}%` }} /></div>
                  </div>
                  <div className="reference-panel panel">
                    <div className="reference-toolbar"><span><Terminal size={14} /> REFERENCE / SOURCE</span><span className="locked-label"><EyeOff size={13} /> READ ONLY</span></div>
                    <pre
                      className="reference-code"
                      onCopy={onForbiddenInput}
                      onCut={onForbiddenInput}
                      onDrop={onForbiddenInput}
                      onDragStart={onForbiddenInput}
                    >{challenge?.referenceText ?? "Round reference is unavailable."}</pre>
                    <div className="reference-footer"><span>EXACT SPACING MATTERS</span><span>UTF-8 · {challenge ? Array.from(challenge.referenceText).length : 0} CHARS</span></div>
                  </div>
                  {state.status === "running" || state.status === "paused" ? (
                    isAdmin ? (
                      <div className="admin-round-controls panel">
                        <div><div className="panel-overline"><Radio size={13} /> ROUND CONTROL</div><b>{state.status === "running" ? "Round in progress" : "Round paused"}</b></div>
                        <div className="control-actions">
                          {state.status === "running"
                            ? <button className="button button-secondary" type="button" onClick={() => void act("pause")} disabled={busy}><Pause size={15} /> PAUSE</button>
                            : <button className="button button-primary" type="button" onClick={() => void act("start")} disabled={busy}><Play size={15} /> RESUME</button>}
                          <button className="button button-danger" type="button" onClick={() => void act("end")} disabled={busy}><Square size={13} /> END ROUND</button>
                        </div>
                      </div>
                    ) : (
                      <div className={`typing-panel panel ${state.status === "paused" ? "typing-paused" : ""}`}>
                        <div className="typing-toolbar"><span><Code2 size={14} /> YOUR INPUT <b>· MASKED</b></span><span><LockKeyhole size={13} /> PRIVATE</span></div>
                        {state.status === "paused" && <div className="paused-banner"><Pause size={14} /> ROUND PAUSED — YOUR INPUT IS SAFE</div>}
                        <div className="masked-input-wrap" onClick={() => textareaRef.current?.focus()}>
                          <pre className="masked-overlay" aria-hidden="true">{maskedDraft || <span className="input-placeholder">Start typing here…</span>}</pre>
                          <textarea
                            ref={textareaRef}
                            value={draft}
                            onChange={(event) => setDraft(event.target.value.slice(0, 10_000))}
                            onKeyDown={(event) => {
                              if (event.key === "Tab") {
                                event.preventDefault();
                                const target = event.currentTarget;
                                const start = target.selectionStart;
                                const end = target.selectionEnd;
                                const next = `${draft.slice(0, start)}\t${draft.slice(end)}`;
                                setDraft(next);
                                requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
                              }
                              if ((event.ctrlKey || event.metaKey) && ["c", "x", "v"].includes(event.key.toLowerCase())) event.preventDefault();
                            }}
                            onPaste={onForbiddenInput}
                            onCopy={onForbiddenInput}
                            onCut={onForbiddenInput}
                            onDrop={onForbiddenInput}
                            onDragStart={onForbiddenInput}
                            onContextMenu={onForbiddenInput}
                            autoCapitalize="off"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            maxLength={10_000}
                            aria-label="Type the reference code. Characters are masked."
                            disabled={state.status !== "running"}
                          />
                        </div>
                        <div className="typing-footer"><span><span className="typing-live-dot" /> INPUT MASKED — KEEP GOING</span><span>{draft.length} CHARACTERS</span></div>
                      </div>
                    )
                  ) : (
                    <RoundResult state={state} ownScore={ownRoundScore} isAdmin={isAdmin} onStart={() => void act("start")} busy={busy} />
                  )}
                  {!isAdmin && <div className="rules-strip"><ShieldCheck size={14} /> No paste. No peeking. Exact characters win — speed is not scored.</div>}
                </div>
                <Scoreboard state={state} currentParticipantId={participantId} isAdmin={isAdmin} />
              </div>
              <div className="arena-bottom-meta"><span><Wifi size={13} /> SERVER CLOCK {state.status === "running" ? "SYNCHRONIZED" : "STANDBY"}</span><span><Shield size={13} /> EACH CHARACTER COUNTS, INCLUDING SPACES</span><span>{state.participants.length} PARTICIPANT{state.participants.length === 1 ? "" : "S"}</span></div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function OrganiserLobby({ state, onAct, busy }: { state: RoomState; onAct: (action: "start" | "pause" | "end") => void; busy: boolean }) {
  return (
    <div className="lobby-grid">
      <div className="panel lobby-panel">
        <div className="lobby-icon"><Sparkles size={21} /></div>
        <div className="panel-overline">ROOM IS READY</div>
        <h2>Get set.<br /><span>Go live.</span></h2>
        <p>Share the six-character room code with your participants. They can join before you start the first round.</p>
        <div className="invite-code"><span>INVITE CODE</span><strong>{state.code}</strong></div>
        <button type="button" className="button button-primary button-wide" onClick={() => onAct("start")} disabled={busy}><Play size={15} /> START ROUND ONE <ArrowRight size={14} /></button>
      </div>
      <div className="panel participant-roster">
        <div className="panel-title-row"><div><div className="panel-overline"><Users size={14} /> THE LINEUP</div><h3>Participants <span className="heading-count">{state.participants.length.toString().padStart(2, "0")}</span></h3></div><span className="waiting-label"><i /> WAITING</span></div>
        {state.participants.length ? state.participants.map((person, index) => <ParticipantRow key={person.id} person={person} index={index} />) : <div className="empty-lineup">No one has joined yet. Your room is open.</div>}
        <div className="scoring-note"><Gauge size={15} /><span><b>Accuracy over speed.</b> Only the exactness of each submission determines the score.</span></div>
      </div>
    </div>
  );
}

function ParticipantLobby({ state, name }: { state: RoomState; name: string }) {
  return (
    <div className="participant-waiting panel">
      <div className="wait-graphic"><span /><span /><span /><Bolt size={24} /></div>
      <div className="panel-overline"><span className="status-dot" /> YOU'RE IN THE ROOM</div>
      <h2>Stay sharp,<br /><span>{name.split(" ")[0]}.</span></h2>
      <p>The organiser will start round one soon. When the clock starts, type what you see — the input stays masked.</p>
      <div className="wait-room-info"><span>ROOM <b>{state.code}</b></span><span><Users size={13} /> {state.participants.length} IN THE ARENA</span></div>
      <div className="waiting-progress"><i /></div>
      <div className="wait-hint"><Clock3 size={14} /> WAITING FOR THE ORGANISER TO START</div>
    </div>
  );
}

function RoundResult({
  state,
  ownScore,
  isAdmin,
  onStart,
  busy
}: {
  state: RoomState;
  ownScore?: ScoreInfo;
  isAdmin: boolean;
  onStart: () => void;
  busy: boolean;
}) {
  const finalRound = state.status === "completed";
  return (
    <div className={`round-result panel ${ownScore?.accuracy === 100 ? "perfect-result" : ""}`}>
      <div className="result-icon">{ownScore?.accuracy === 100 ? <Crown size={18} /> : <BadgeCheck size={18} />}</div>
      <div className="result-copy">
        <div className="panel-overline">{finalRound ? "EVENT COMPLETE" : "ROUND COMPLETE"}</div>
        <h3>{isAdmin ? (finalRound ? "Final scores are in." : "Round locked.") : ownScore ? "Your result is in." : "Time is up."}</h3>
        {!isAdmin && ownScore && <p><b>{ownScore.accuracy.toFixed(2)}%</b> accuracy <span>·</span> {ownScore.errors} character error{ownScore.errors === 1 ? "" : "s"}</p>}
        {!isAdmin && !ownScore && <p>No submission recorded for this round.</p>}
        {!finalRound && isAdmin && <p>Scores are locked. Start the next round when the room is ready.</p>}
      </div>
      <div className="result-points"><strong>{ownScore?.points.toFixed(1) ?? "—"}</strong><span>/ {ROUND_POINTS[state.round]} PTS</span></div>
      {isAdmin && !finalRound && <button type="button" className="button button-primary" onClick={onStart} disabled={busy}>START ROUND 0{state.round + 1} <ArrowRight size={14} /></button>}
      {finalRound && <div className="final-crown"><Trophy size={16} /> EVENT COMPLETE</div>}
    </div>
  );
}

function Scoreboard({ state, currentParticipantId, isAdmin }: { state: RoomState; currentParticipantId: string; isAdmin: boolean }) {
  const sorted = useMemo(() => [...state.participants].sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name)), [state.participants]);
  const top = sorted[0];
  return (
    <aside className="scoreboard panel">
      <div className="scoreboard-head"><div><div className="panel-overline"><Radio size={13} /> LIVE RANKING</div><h3>Leaderboard <ChevronDown size={16} /></h3></div><span className="score-live"><i /> LIVE</span></div>
      <div className="leaderboard-labels"><span>RANK / PLAYER</span><span>PTS / ACCURACY</span></div>
      {sorted.length === 0 ? (
        <div className="empty-leaderboard"><Users size={19} /><span>Waiting for participants to join…</span></div>
      ) : (
        sorted.map((person, index) => (
          <ParticipantScoreRow
            key={person.id}
            person={person}
            index={index}
            scores={state.scores.filter((score) => score.participantId === person.id)}
            currentRound={state.round}
            isCurrent={person.id === currentParticipantId && !isAdmin}
            isLeading={Boolean(top && top.totalPoints > 0 && person.totalPoints === top.totalPoints)}
          />
        ))
      )}
      <div className="leaderboard-total">
        <span>{state.participants.length} PLAYER{state.participants.length === 1 ? "" : "S"}</span>
        <span>MAX SCORE <b>60</b></span>
      </div>
      <div className="accuracy-callout"><Sparkles size={15} /><span><b>Accuracy is everything.</b><small>No speed bonus. Precision wins.</small></span></div>
    </aside>
  );
}

function ParticipantRow({ person, index }: { person: ParticipantInfo; index: number }) {
  return <div className="participant-line"><span className="rank-number">{String(index + 1).padStart(2, "0")}</span><span className="avatar">{person.name.charAt(0).toUpperCase()}</span><b>{person.name}</b><span className="joined-tag">READY</span></div>;
}

function ParticipantScoreRow({
  person,
  index,
  scores,
  currentRound,
  isCurrent,
  isLeading
}: {
  person: ParticipantInfo;
  index: number;
  scores: ScoreInfo[];
  currentRound: RoundNumber;
  isCurrent: boolean;
  isLeading: boolean;
}) {
  return (
    <div className={`score-row ${isCurrent ? "score-row-you" : ""} ${isLeading ? "score-row-leader" : ""}`}>
      <div className="player-cell"><span className={`rank-number ${index === 0 && person.totalPoints > 0 ? "rank-first" : ""}`}>{index === 0 && person.totalPoints > 0 ? <Crown size={13} /> : String(index + 1).padStart(2, "0")}</span><span className="avatar">{person.name.charAt(0).toUpperCase()}</span><div><b>{person.name}{isCurrent && <small>YOU</small>}</b><span>{person.roundsCompleted} / 3 ROUNDS</span></div></div>
      <div className="score-values">
        {([1, 2, 3] as RoundNumber[]).map((round) => {
          const score = scores.find((entry) => entry.round === round);
          return (
            <span className={`score-cell ${score ? "scored" : ""} ${round === currentRound ? "score-current" : ""}`} key={round} title={score ? `${score.accuracy.toFixed(2)}% accuracy` : "Round not scored"}>
              {score ? <><b>{score.points.toFixed(1)}</b><small>{score.accuracy.toFixed(2)}%</small></> : "—"}
            </span>
          );
        })}
        <strong>{person.totalPoints.toFixed(1)}</strong>
      </div>
    </div>
  );
}

function Footer() {
  return <footer className="site-footer"><span>© SIGNAL/NOISE · BLIND CODING CHALLENGE</span><span><CircleHelp size={13} /> ACCURACY OVER SPEED. ALWAYS.</span><span>BUILT FOR THE BOLD <span className="footer-heart">✳</span></span></footer>;
}

export default App;
