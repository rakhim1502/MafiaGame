import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";

import {
  findRoomByCode,
  listenPlayers,
  listenRoomById,
  updatePlayer,
  startGame,
  submitNightAction,
  resolveNight,
  startVote,
  submitVote,
  resolveVote,
  setPlayerConnection,
  heartbeat,
  ensurePlayerExists,
  listenMessages,
  sendMessage,
  listenEvents,
  updateRoomSettings,
} from "../firebase/roomService";

import { avatars, avatarSrc } from "../data/avatars";
import { roleAssets } from "../data/roles";

function formatSec(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function isMafiaRole(role: string) {
  return role === "mafia" || role === "don";
}

function ResultModal({
  open,
  type,
  title,
  subtitle,
  onClose,
}: {
  open: boolean;
  type: "win" | "lose" | "info";
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const badge =
    type === "win"
      ? "bg-emerald-500 text-slate-900"
      : type === "lose"
      ? "bg-rose-500 text-slate-900"
      : "bg-white text-slate-900";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/70"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            className="relative w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            initial={{ scale: 0.85, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
          >
            <div className="flex items-center justify-between">
              <span className={`text-xs px-3 py-1 rounded-full font-semibold ${badge}`}>
                {type.toUpperCase()}
              </span>
              <button onClick={onClose} className="text-slate-300 hover:text-white text-sm">
                ✕
              </button>
            </div>

            <motion.div
              className="mt-4 h-16 rounded-2xl border border-slate-700 bg-slate-800 relative overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                className="absolute -left-10 top-4 h-8 w-28 rounded-full bg-white/10"
                animate={{ x: [0, 520] }}
                transition={{ duration: 2.5, repeat: Infinity }}
              />
              <motion.div
                className="absolute -left-20 top-8 h-6 w-20 rounded-full bg-white/10"
                animate={{ x: [0, 520] }}
                transition={{ duration: 3.2, repeat: Infinity }}
              />
            </motion.div>

            <h3 className="mt-4 text-2xl font-bold">{title}</h3>
            {subtitle && <p className="mt-2 text-slate-300">{subtitle}</p>}

            <button
              onClick={onClose}
              className="mt-6 w-full rounded-2xl bg-white text-slate-900 font-semibold py-3 hover:opacity-95"
            >
              Back to Home
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Room() {
  const { code } = useParams();
  const nav = useNavigate();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [targetId, setTargetId] = useState<string>("");
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const [nightSecInput, setNightSecInput] = useState<number>(60);
  const [daySecInput, setDaySecInput] = useState<number>(60);
  const [voteSecInput, setVoteSecInput] = useState<number>(45);

  const [msgs, setMsgs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatScope, setChatScope] = useState<"lobby" | "public" | "mafia">("lobby");

  const [resultModal, setResultModal] = useState<{
    open: boolean;
    type: "win" | "lose" | "info";
    title: string;
    subtitle?: string;
  }>({ open: false, type: "info", title: "" });

  const NIGHT_SEC = room?.settings?.nightSec ?? 60;
  const DAY_SEC = room?.settings?.daySec ?? 60;
  const VOTE_SEC = room?.settings?.voteSec ?? 45;

  const autoLockRef = useRef<string>("");
  const winnerLockRef = useRef<string>(""); 

  const playerId = useMemo(() => {
    if (!code) return null;
    return localStorage.getItem(`playerId_${code}`);
  }, [code]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!code) return;

    let unsubPlayers: null | (() => void) = null;
    let unsubRoom: null | (() => void) = null;

    (async () => {
      setLoading(true);
      const r = await findRoomByCode(code);
      if (!r) {
        toast.error("Room topilmadi");
        nav("/");
        return;
      }

      setRoomId(r.roomId);

      unsubRoom = listenRoomById(r.roomId, (data) => {
        setRoom(data);

        const s = data?.settings;
        if (s) {
          setNightSecInput((prev) => prev || Number(s.nightSec ?? 60));
          setDaySecInput((prev) => prev || Number(s.daySec ?? 60));
          setVoteSecInput((prev) => prev || Number(s.voteSec ?? 45));
        }
      });

      unsubPlayers = listenPlayers(r.roomId, (p) => {
        setPlayers(p);
        setLoading(false);
      });
    })();

    return () => {
      if (unsubPlayers) unsubPlayers();
      if (unsubRoom) unsubRoom();
    };
  }, [code, nav]);

  useEffect(() => {
    if (!roomId) return;

    const u1 = listenMessages(roomId, setMsgs);
    const u2 = listenEvents(roomId, setEvents);

    return () => {
      u1?.();
      u2?.();
    };
  }, [roomId]);

  const me = useMemo(() => {
    if (!playerId) return null;
    return players.find((p) => p.id === playerId) || null;
  }, [players, playerId]);

  const isHost = useMemo(() => {
    if (!room || !playerId) return false;
    return room.ownerPlayerId === playerId;
  }, [room, playerId]);

  const allReady = useMemo(() => {
    if (players.length === 0) return false;
    return players.every((p) => p.isReady);
  }, [players]);

  const alivePlayers = useMemo(() => players.filter((p) => p.isAlive), [players]);

  const myRole = (me?.role as any) ?? "unknown";
  const isMafiaPlayer = myRole === "mafia" || myRole === "don";
  const isDoctor = myRole === "doctor";
  const isKomissar = myRole === "komissar";

  const myRoleAsset = roleAssets[myRole] || roleAssets.unknown;

  const myVoteTarget = useMemo(() => {
    if (!me?.id) return null;
    return room?.vote?.votes?.[me.id] || null;
  }, [room, me]);

  const timeLeftSec = useMemo(() => {
    const ends = room?.phaseEndsAtMs;
    if (!ends || room?.phase === "ended" || room?.status !== "playing") return null;
    return Math.ceil((ends - nowMs) / 1000);
  }, [room, nowMs]);

  useEffect(() => {
    if (!roomId || !playerId) return;

    (async () => {
      const ok = await ensurePlayerExists(roomId, playerId);
      if (!ok) {
        toast.error("Player topilmadi. Home’dan qayta kiring.");
        nav("/");
        return;
      }
      await setPlayerConnection(roomId, playerId, true);
    })();

    const hb = setInterval(() => {
      heartbeat(roomId, playerId).catch(() => {});
    }, 5000);

    const onUnload = () => {
      setPlayerConnection(roomId, playerId, false).catch(() => {});
    };

    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(hb);
      window.removeEventListener("beforeunload", onUnload);
      setPlayerConnection(roomId, playerId, false).catch(() => {});
    };
  }, [roomId, playerId, nav]);

  useEffect(() => {
    if (!isHost) return;
    if (!roomId) return;

    const tick = async () => {
      if (!room) return;
      if (room.status !== "playing") return;
      if (!room.phaseEndsAtMs) return;

      const key = `${room.phase}-${room.phaseEndsAtMs}`;
      if (autoLockRef.current === `done-${key}`) return;

      const expired = Date.now() >= Number(room.phaseEndsAtMs);
      if (!expired) return;

      autoLockRef.current = `done-${key}`;

      try {
        if (room.phase === "night") {
          await resolveNight(roomId, DAY_SEC);
          setTargetId("");
        } else if (room.phase === "day") {
          await startVote(roomId, VOTE_SEC);
          setTargetId("");
        } else if (room.phase === "vote") {
          await resolveVote(roomId, NIGHT_SEC);
          setTargetId("");
        }
      } catch (e) {
        console.log("auto-advance error:", e);
        autoLockRef.current = "";
      }
    };

    const i = setInterval(() => {
      tick().catch(() => {});
    }, 1000);

    return () => clearInterval(i);
  }, [isHost, roomId, room, DAY_SEC, VOTE_SEC, NIGHT_SEC]);

  useEffect(() => {
    if (!room) return;
    if (room.status !== "ended") return;

    const key = `${room.winner}-${room.endedAt || room.phaseEndsAtMs || "x"}`;
    if (winnerLockRef.current === key) return;
    winnerLockRef.current = key;

    const winner = room.winner; 
    const winText = winner === "mafia" ? "MAFIA 😈" : "TOWN 🙂";

    const iWin =
      (winner === "mafia" && (me?.role === "mafia" || me?.role === "don")) ||
      (winner === "town" && !(me?.role === "mafia" || me?.role === "don"));

    setResultModal({
      open: true,
      type: iWin ? "win" : "lose",
      title: iWin ? "You won! 🎉" : "You lost 😭",
      subtitle: `Winner: ${winText}`,
    });

    toast(iWin ? "GG! You won 🎉" : "GG! Next time 😄", { icon: iWin ? "🏆" : "💀" });
  }, [room?.status, room?.winner, me?.role]);

  async function setAvatar(aId: string) {
    if (!roomId || !playerId) return;
    await updatePlayer(roomId, playerId, { avatar: aId });
    if (code) localStorage.setItem(`avatar_${code}`, aId);
    toast.success("Avatar updated ✅");
  }

  async function toggleReady() {
    if (!roomId || !playerId || !me) return;
    await updatePlayer(roomId, playerId, { isReady: !me.isReady });
    toast.success(!me.isReady ? "Ready ✅" : "Unready");
  }

  async function onStartGame() {
    if (!roomId) return;
    if (!allReady) return toast.error("Hamma READY bo‘lsin");
    try {
      await startGame(roomId); 
      setTargetId("");
      autoLockRef.current = "";
      toast.success("Game started 🎮");
    } catch (e: any) {
      toast.error(e?.message || "Start error");
    }
  }

  async function onSubmitNight() {
    if (!roomId || !me?.id) return;
    if (!targetId) return toast.error("Target tanlang");
    if (me?.nightSubmitted) return toast("Siz actionni yuborgan siz ✅", { icon: "✅" });

    const roleToSend =
      isMafiaPlayer ? (myRole === "don" ? "don" : "mafia") : isDoctor ? "doctor" : "komissar";

    try {
      await submitNightAction({
        roomId,
        role: roleToSend,
        actorPlayerId: me.id,
        targetPlayerId: targetId,
      });
      toast.success("Action submitted ✅");
    } catch (e: any) {
      toast.error(e?.message || "Submit error");
    }
  }

  async function onSubmitVote() {
    if (!roomId || !me?.id) return;
    if (!targetId) return toast.error("Kimga ovoz berishni tanlang");
    if (me?.voteSubmitted) return toast("Siz ovoz berib bo‘lgansiz ✅", { icon: "✅" });

    try {
      await submitVote({
        roomId,
        voterPlayerId: me.id,
        targetPlayerId: targetId,
      });
      toast.success("Vote submitted ✅");
    } catch (e: any) {
      toast.error(e?.message || "Vote error");
    }
  }

  async function onLeave() {
    if (!roomId || !playerId) return;
    await setPlayerConnection(roomId, playerId, false);
    toast("Left room", { icon: "👋" });
    nav("/");
  }

  const komissarBox = useMemo(() => {
    if (!isKomissar) return null;
    const res = me?.private?.lastCheckResult;
    if (!res?.targetId) return null;

    const name = players.find((p) => p.id === res.targetId)?.nickname || "Unknown";
    return (
      <div className="mt-3 bg-slate-900 border border-slate-700 rounded-xl p-3">
        <p className="text-sm">
          Tekshiruv natijasi: <span className="font-semibold">{name}</span> —{" "}
          <span className="font-bold">{res.isMafia ? "MAFIA 😈" : "TINCH 🙂"}</span>
        </p>
      </div>
    );
  }, [isKomissar, me, players]);

  const killedName = useMemo(() => {
    const killedId = room?.night?.lastKilledPlayerId;
    if (!killedId) return "Hech kim o‘lmadi";
    return players.find((p) => p.id === killedId)?.nickname || "Unknown";
  }, [room, players]);

  const eliminatedName = useMemo(() => {
    const id = room?.vote?.eliminatedPlayerId;
    if (!id) return "Hech kim chiqarilmadi (durang yoki ovoz yo‘q)";
    return players.find((p) => p.id === id)?.nickname || "Unknown";
  }, [room, players]);


  const onlineSet = useMemo(() => {
    const s = new Set<string>();
    const now = Date.now();
    for (const p of players) {
      const last = Number(p.lastSeenAtMs || 0);
      const online = p.isConnected && now - last <= 12000;
      if (online) s.add(p.id);
    }
    return s;
  }, [players, nowMs]);

  const visibleMsgs = useMemo(() => {
    if (!room) return [];

    return msgs.filter((m) => {
      if (m.scope === "mafia") return isMafiaPlayer;
      if (m.scope === "lobby") return room?.status === "lobby" || room?.phase === "lobby";
      return true; // public
    });
  }, [msgs, isMafiaPlayer, room]);

  async function onSendChat() {
    if (!roomId || !me?.id) return;
    const text = chatText.trim();
    if (!text) return;

    const scopeToSend = chatScope === "mafia" && !isMafiaPlayer ? "public" : chatScope;

    try {
      await sendMessage({
        roomId,
        senderId: me.id,
        senderNick: me.nickname || "Player",
        text,
        scope: scopeToSend,
      });
      setChatText("");
    } catch (e: any) {
      toast.error(e?.message || "Chat error");
    }
  }

  async function onSaveSettings() {
    if (!isHost || !roomId) return;

    const n = Math.max(10, Math.min(300, Number(nightSecInput || 60)));
    const d = Math.max(10, Math.min(300, Number(daySecInput || 60)));
    const v = Math.max(10, Math.min(300, Number(voteSecInput || 45)));

    try {
      await updateRoomSettings(roomId, { nightSec: n, daySec: d, voteSec: v });
      toast.success("Saved ✅");
    } catch (e: any) {
      toast.error(e?.message || "Save error");
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Room Lobby / Game</h2>
          <div className="flex gap-2">
            <button
              onClick={onLeave}
              className="px-4 py-2 rounded-xl bg-rose-500 text-slate-900 font-semibold"
            >
              Leave
            </button>
            <button
              onClick={() => nav("/")}
              className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:opacity-90"
            >
              Home
            </button>
          </div>
        </div>

        {/* RESULT MODAL */}
        <ResultModal
          open={resultModal.open}
          type={resultModal.type}
          title={resultModal.title}
          subtitle={resultModal.subtitle}
          onClose={() => {
            setResultModal((p) => ({ ...p, open: false }));
            nav("/");
          }}
        />

        {/* TOP GRID */}
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <p className="text-slate-300 text-sm">Room Code</p>
            <p className="text-3xl font-bold tracking-widest mt-1">{code}</p>

            <button
              onClick={() => {
                navigator.clipboard.writeText(code || "");
                toast.success("Copied ✅");
              }}
              className="mt-3 w-full px-4 py-2 rounded-xl bg-white text-slate-900 font-semibold"
            >
              Copy
            </button>

            <div className="mt-4">
              <p className="text-slate-300 text-sm mb-2">My status</p>
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <img
                    src={avatarSrc(me?.avatar)}
                    className="w-12 h-12 rounded-2xl border border-slate-700 bg-slate-800"
                    alt="me"
                  />
                  <div>
                    <p className="text-sm">
                      Nick: <span className="font-semibold">{me?.nickname || "?"}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <img src={myRoleAsset.src} className="w-5 h-5" alt="role" />
                      <p className="text-sm">
                        Role: <span className="font-semibold">{myRoleAsset.label}</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <p>
                    Alive:{" "}
                    <span className={me?.isAlive ? "text-emerald-400" : "text-rose-400"}>
                      {me?.isAlive ? "YES" : "NO"}
                    </span>
                  </p>
                  <p>
                    Ready:{" "}
                    <span className={me?.isReady ? "text-emerald-400" : "text-rose-400"}>
                      {me?.isReady ? "YES" : "NO"}
                    </span>
                  </p>
                  <p>
                    Night:{" "}
                    <span className={me?.nightSubmitted ? "text-emerald-400" : "text-slate-300"}>
                      {me?.nightSubmitted ? "submitted ✅" : "not yet"}
                    </span>
                  </p>
                  <p>
                    Vote:{" "}
                    <span className={me?.voteSubmitted ? "text-emerald-400" : "text-slate-300"}>
                      {me?.voteSubmitted ? "submitted ✅" : "not yet"}
                    </span>
                  </p>
                </div>

                <p className="text-xs mt-2 text-slate-400">Siz: {isHost ? "HOST 👑" : "PLAYER"}</p>
              </div>

              <button
                onClick={toggleReady}
                disabled={!me || room?.status === "playing" || room?.status === "ended"}
                className="mt-3 w-full px-4 py-2 rounded-xl bg-emerald-500 text-slate-900 font-semibold disabled:opacity-50"
              >
                {me?.isReady ? "Unready" : "Ready"}
              </button>

              {isHost && (
                <button
                  onClick={onStartGame}
                  disabled={!allReady || room?.status === "playing" || room?.status === "ended"}
                  className="mt-3 w-full px-4 py-2 rounded-xl bg-purple-500 text-slate-900 font-semibold disabled:opacity-50"
                >
                  Start Game
                </button>
              )}
            </div>

            {isHost && (
              <div className="mt-5 bg-slate-900 border border-slate-700 rounded-2xl p-3">
                <p className="font-semibold">Host Settings</p>
                <p className="text-xs text-slate-400 mt-1">10–300 sec</p>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-xs text-slate-400">Night</p>
                    <input
                      value={nightSecInput}
                      onChange={(e) => setNightSecInput(Number(e.target.value))}
                      className="w-full mt-1 px-2 py-2 rounded-xl bg-slate-800 border border-slate-700"
                      type="number"
                      min={10}
                      max={300}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Day</p>
                    <input
                      value={daySecInput}
                      onChange={(e) => setDaySecInput(Number(e.target.value))}
                      className="w-full mt-1 px-2 py-2 rounded-xl bg-slate-800 border border-slate-700"
                      type="number"
                      min={10}
                      max={300}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Vote</p>
                    <input
                      value={voteSecInput}
                      onChange={(e) => setVoteSecInput(Number(e.target.value))}
                      className="w-full mt-1 px-2 py-2 rounded-xl bg-slate-800 border border-slate-700"
                      type="number"
                      min={10}
                      max={300}
                    />
                  </div>
                </div>

                <button
                  onClick={onSaveSettings}
                  className="mt-3 w-full px-4 py-2 rounded-xl bg-white text-slate-900 font-semibold"
                >
                  Save Settings
                </button>
              </div>
            )}
          </div>

          {/* MIDDLE: TIMER + PHASE CONTENT */}
          <div className="lg:col-span-2">
            {room?.status === "playing" && room?.phase !== "ended" && timeLeftSec !== null && (
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-300">Phase</p>
                  <p className="font-semibold text-lg">{room.phase.toUpperCase()}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Night/Day/Vote: {NIGHT_SEC}/{DAY_SEC}/{VOTE_SEC} sec
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-300">Time left</p>
                  <p className="font-bold text-2xl">{formatSec(timeLeftSec)}</p>
                  <p className="text-xs text-slate-400">
                    Timer: {isHost ? "HOST ✅" : "Host boshqaradi"}
                  </p>
                </div>
              </div>
            )}

            {/* GAME / WINNER */}
            {room?.status === "ended" && (
              <div className="mt-4 bg-amber-900/40 border border-amber-700 rounded-2xl p-4">
                <p className="font-semibold text-lg">🏁 Game Ended</p>
                <p className="text-slate-200 mt-1">
                  Winner:{" "}
                  <span className="font-bold">
                    {room.winner === "mafia" ? "MAFIA 😈" : "TOWN 🙂"}
                  </span>
                </p>
              </div>
            )}

            {room?.status === "playing" && (
              <div className="mt-4 bg-purple-900/40 border border-purple-700 rounded-2xl p-4">
                <p className="font-semibold">Game started 🎮</p>
                <p className="text-sm text-slate-300">Phase: {room.phase}</p>
                <div className="mt-2 flex items-center gap-2">
                  <img src={myRoleAsset.src} className="w-6 h-6" alt="role" />
                  <p className="text-sm text-slate-300">
                    Sizning role: <span className="font-bold">{myRoleAsset.label}</span>
                  </p>
                </div>
              </div>
            )}

            {/* NIGHT */}
            {room?.status === "playing" && room?.phase === "night" && (
              <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
                <p className="font-semibold text-lg">🌙 Night Phase</p>

                {isMafiaPlayer || isDoctor || isKomissar ? (
                  <>
                    <p className="mt-3 text-sm text-slate-300">
                      {isMafiaPlayer && "Kimni o‘ldirmoqchisiz?"}
                      {isDoctor && "Kimni saqlamoqchisiz?"}
                      {isKomissar && "Kimni tekshirmoqchisiz?"}
                    </p>

                    <div className="mt-3 grid sm:grid-cols-2 gap-2">
                      {alivePlayers
                        .filter((p) => p.id !== me?.id)
                        .map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setTargetId(p.id)}
                            className={
                              "p-3 rounded-2xl border text-left flex items-center gap-3 " +
                              (targetId === p.id
                                ? "bg-white text-slate-900 border-white"
                                : "bg-slate-900 border-slate-700 hover:opacity-90")
                            }
                          >
                            <img
                              src={avatarSrc(p.avatar)}
                              className="w-10 h-10 rounded-2xl border border-slate-700 bg-slate-800"
                              alt="avatar"
                            />
                            <div>
                              <p className="font-semibold flex items-center gap-2">
                                {p.nickname}
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-white">
                                  {onlineSet.has(p.id) ? "online" : "offline"}
                                </span>

                                {isMafiaPlayer && isMafiaRole(p.role) && p.id !== me?.id && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500 text-slate-900">
                                    teammate
                                  </span>
                                )}
                              </p>
                              <p className="text-xs opacity-70">{p.avatar}</p>
                            </div>
                          </button>
                        ))}
                    </div>

                    <button
                      onClick={onSubmitNight}
                      disabled={!!me?.nightSubmitted}
                      className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-slate-900 font-semibold disabled:opacity-50"
                    >
                      {me?.nightSubmitted ? "Submitted ✅" : "Submit Action"}
                    </button>
                  </>
                ) : (
                  <p className="mt-3 text-slate-300">Siz kechasi action qilmaydigan roldasiz. Kuting...</p>
                )}
              </div>
            )}

            {/* DAY */}
            {room?.status === "playing" && room?.phase === "day" && (
              <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
                <p className="font-semibold text-lg">☀️ Day Phase</p>
                <p className="text-sm text-slate-300 mt-2">
                  Kechasi o‘lgan o‘yinchi: <span className="font-bold">{killedName}</span>
                </p>
                {komissarBox}
              </div>
            )}

            {/* VOTE */}
            {room?.status === "playing" && room?.phase === "vote" && (
              <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
                <p className="font-semibold text-lg">🗳️ Vote Phase</p>

                {!me?.isAlive ? (
                  <p className="mt-3 text-slate-300">Siz o‘lgansiz 💀. Ovoz bera olmaysiz.</p>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-slate-300">Kimni chiqarib yuborishga ovoz berasiz?</p>

                    <div className="mt-3 grid sm:grid-cols-2 gap-2">
                      {alivePlayers
                        .filter((p) => p.id !== me?.id)
                        .map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setTargetId(p.id)}
                            className={
                              "p-3 rounded-2xl border text-left flex items-center gap-3 " +
                              (targetId === p.id
                                ? "bg-white text-slate-900 border-white"
                                : "bg-slate-900 border-slate-700 hover:opacity-90")
                            }
                          >
                            <img
                              src={avatarSrc(p.avatar)}
                              className="w-10 h-10 rounded-2xl border border-slate-700 bg-slate-800"
                              alt="avatar"
                            />
                            <div>
                              <p className="font-semibold flex items-center gap-2">
                                {p.nickname}
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-white">
                                  {onlineSet.has(p.id) ? "online" : "offline"}
                                </span>
                              </p>
                              <p className="text-xs opacity-70">{p.avatar}</p>
                            </div>
                          </button>
                        ))}
                    </div>

                    <button
                      onClick={onSubmitVote}
                      disabled={!!me?.voteSubmitted}
                      className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-slate-900 font-semibold disabled:opacity-50"
                    >
                      {me?.voteSubmitted ? "Voted ✅" : "Submit Vote"}
                    </button>

                    <p className="mt-3 text-xs text-slate-400">
                      Sizning hozirgi ovozingiz:{" "}
                      <span className="font-semibold">
                        {myVoteTarget
                          ? players.find((p) => p.id === myVoteTarget)?.nickname || "Unknown"
                          : "yo‘q"}
                      </span>
                    </p>
                  </>
                )}
              </div>
            )}

            {room?.status === "playing" && room?.vote?.resolved && room?.phase === "night" && (
              <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
                <p className="font-semibold">Vote Result</p>
                <p className="text-sm text-slate-300 mt-2">
                  Chiqib ketgan o‘yinchi: <span className="font-bold">{eliminatedName}</span>
                </p>
              </div>
            )}

            <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
              <p className="font-semibold mb-2">Choose avatar</p>
              <div className="flex flex-wrap gap-2">
                {avatars.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAvatar(a.id)}
                    disabled={room?.status === "playing" || room?.status === "ended"}
                    className={
                      "p-2 rounded-2xl border disabled:opacity-50 " +
                      (me?.avatar === a.id
                        ? "bg-white text-slate-900 border-white"
                        : "bg-slate-900 border-slate-700 hover:opacity-90")
                    }
                    title={a.id}
                  >
                    <img src={a.src} className="w-10 h-10 rounded-xl" alt={a.id} />
                  </button>
                ))}
              </div>

              <p className="text-xs text-slate-400 mt-2">
                O‘yin boshlanganidan keyin avatar/ready o‘zgarmaydi (MVP).
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold">Players</p>
              <span className="text-sm text-slate-300">{players.length} ta</span>
            </div>

            {loading ? (
              <p className="text-slate-300">Loading...</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className={
                      "border rounded-2xl p-3 flex items-center justify-between " +
                      (p.isAlive ? "bg-slate-900 border-slate-700" : "bg-rose-900/30 border-rose-700")
                    }
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={avatarSrc(p.avatar)}
                        className="w-10 h-10 rounded-2xl border border-slate-700 bg-slate-800"
                        alt="avatar"
                      />
                      <div>
                        <p className="font-semibold flex items-center gap-2">
                          {p.nickname} {!p.isAlive ? "💀" : ""}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700">
                            {onlineSet.has(p.id) ? "online" : "offline"}
                          </span>

                          {isMafiaPlayer && isMafiaRole(p.role) && p.id !== me?.id && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500 text-slate-900">
                              teammate
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{p.avatar}</p>
                      </div>
                    </div>

                    <span
                      className={
                        "text-xs px-3 py-1 rounded-full " +
                        (p.isReady ? "bg-emerald-500 text-slate-900" : "bg-slate-700 text-white")
                      }
                    >
                      {p.isReady ? "READY" : "WAIT"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <p className="font-semibold">Chat</p>

            <div className="mt-3 flex gap-2">
              <select
                value={chatScope}
                onChange={(e) => setChatScope(e.target.value as any)}
                className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm"
              >
                <option value="lobby">Lobby</option>
                <option value="public">Public</option>
                <option value="mafia" disabled={!isMafiaPlayer}>
                  Mafia
                </option>
              </select>

              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSendChat();
                }}
                placeholder="Message..."
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm"
              />

              <button
                onClick={onSendChat}
                className="px-4 py-2 rounded-xl bg-white text-slate-900 font-semibold"
              >
                Send
              </button>
            </div>

            <div className="mt-3 h-56 overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-3 space-y-2">
              {visibleMsgs.length === 0 ? (
                <p className="text-sm text-slate-400">No messages</p>
              ) : (
                visibleMsgs.map((m) => (
                  <div key={m.id} className="text-sm">
                    <span className="text-slate-400">{m.senderNick}:</span>{" "}
                    <span className="text-white">{m.text}</span>{" "}
                    <span className="text-xs text-slate-500">[{m.scope}]</span>
                  </div>
                ))
              )}
            </div>

            <p className="font-semibold mt-5">Events</p>
            <div className="mt-2 h-48 overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-3 space-y-2">
              {events.length === 0 ? (
                <p className="text-sm text-slate-400">No events</p>
              ) : (
                events
                  .slice()
                  .reverse()
                  .slice(0, 30)
                  .map((e) => (
                    <div key={e.id} className="text-sm">
                      <span className="text-slate-400">{e.type}</span>:{" "}
                      <span className="text-white">{e.text}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
