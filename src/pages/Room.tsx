import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
const navigate: NavigateFunction = useNavigate();
navigate("/");

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
  autoRejoinIfNeeded,
  kickPlayer,
} from "../firebase/roomService";
import { avatars } from "../data/avatars";

function formatSec(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
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

  const NIGHT_SEC = 60;
  const DAY_SEC = 60;
  const VOTE_SEC = 45;

  const autoLockRef = useRef<string>("");

  const playerId = useMemo(() => {
    if (!code) return null;
    return localStorage.getItem(`playerId_${code}`);
  }, [code]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // load room + listeners
  useEffect(() => {
    if (!code) return;

    let unsubPlayers: null | (() => void) = null;
    let unsubRoom: null | (() => void) = null;

    (async () => {
      setLoading(true);
      const r = await findRoomByCode(code);
      if (!r) {
        alert("Room topilmadi");
        navigate("/");
        return;
      }

      setRoomId(r.roomId);

      unsubRoom = listenRoomById(r.roomId, (data) => setRoom(data));
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

  const me = useMemo(() => {
    if (!playerId) return null;
    return players.find((p) => p.id === playerId) || null;
  }, [players, playerId]);

  // ✅ kicked bo‘lsa chiqarib yuboramiz
  useEffect(() => {
    if (!me) return;
    if (me.isKicked) {
      alert("Siz host tomonidan kick qilindingiz.");
      if (code) {
        localStorage.removeItem(`playerId_${code}`);
        localStorage.removeItem(`roomId_${code}`);
      }
      navigate("/");
    }
  }, [me, nav, code]);

  const isHost = useMemo(() => {
    if (!room || !playerId) return false;
    return room.ownerPlayerId === playerId;
  }, [room, playerId]);

  const allReady = useMemo(() => {
    if (players.length === 0) return false;
    return players.every((p) => p.isReady);
  }, [players]);

  const alivePlayers = useMemo(() => players.filter((p) => p.isAlive), [players]);

  const myRole = me?.role as any;
  const isMafiaPlayer = myRole === "mafia" || myRole === "don";
  const isDoctor = myRole === "doctor";
  const isKomissar = myRole === "komissar";

  const myVoteTarget = useMemo(() => {
    if (!me?.id) return null;
    return room?.vote?.votes?.[me.id] || null;
  }, [room, me]);

  const timeLeftSec = useMemo(() => {
    const ends = room?.phaseEndsAtMs;
    if (!ends || room?.phase === "ended" || room?.status !== "playing") return null;
    return Math.ceil((ends - nowMs) / 1000);
  }, [room, nowMs]);

  // ✅ AUTO REJOIN: player doc yo‘q bo‘lsa qayta qo‘shadi
  useEffect(() => {
    if (!roomId || !code) return;

    (async () => {
      const res = await autoRejoinIfNeeded({
        roomId,
        code,
        nicknameFallback: "Guest",
        avatarFallback: "avatar_1",
      });

      // agar yangi player yaratgan bo‘lsa, UI yangilansin
      if (res.didRejoin) {
        // hech narsa shart emas — listenerlar update qiladi
      }
    })();
  }, [roomId, code]);

  // heartbeat + leave/offline
  useEffect(() => {
    if (!roomId || !playerId) return;

    setPlayerConnection(roomId, playerId, true).catch(() => {});

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
  }, [roomId, playerId]);

  // host auto-advance (oldingi fix usul)
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

  async function setAvatar(a: string) {
    if (!roomId || !playerId || !code) return;
    await updatePlayer(roomId, playerId, { avatar: a });
    localStorage.setItem(`avatar_${code}`, a);
  }

  async function toggleReady() {
    if (!roomId || !playerId || !me) return;
    await updatePlayer(roomId, playerId, { isReady: !me.isReady });
  }

  async function onStartGame() {
    if (!roomId) return;
    if (!allReady) return alert("Hamma READY bo‘lsin");
    try {
      await startGame(roomId, NIGHT_SEC);
      setTargetId("");
      autoLockRef.current = "";
    } catch (e: any) {
      alert(e?.message || "Start error");
    }
  }

  async function onSubmitNight() {
    if (!roomId || !me?.id) return;
    if (!targetId) return alert("Target tanlang");

    const roleToSend =
      isMafiaPlayer ? (myRole === "don" ? "don" : "mafia") : isDoctor ? "doctor" : "komissar";

    try {
      await submitNightAction({
        roomId,
        role: roleToSend,
        actorPlayerId: me.id,
        targetPlayerId: targetId,
      });
      alert("Action submitted ✅");
    } catch (e: any) {
      alert(e?.message || "Submit error");
    }
  }

  async function onSubmitVote() {
    if (!roomId || !me?.id) return;
    if (!targetId) return alert("Kimga ovoz berishni tanlang");

    try {
      await submitVote({
        roomId,
        voterPlayerId: me.id,
        targetPlayerId: targetId,
      });
      alert("Vote submitted ✅");
    } catch (e: any) {
      alert(e?.message || "Vote error");
    }
  }

  async function onLeave() {
    if (!roomId || !playerId) return;
    await setPlayerConnection(roomId, playerId, false);
    navigate("/");
  }

  async function onKick(targetPlayerId: string) {
    if (!isHost || !roomId) return;
    if (targetPlayerId === playerId) return alert("O‘zingizni kick qila olmaysiz");
    await kickPlayer(roomId, targetPlayerId);
  }

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

  const checkBox = useMemo(() => {
    if (!isKomissar) return null;
    const res = room?.day?.lastCheckResult;
    if (!res?.targetPlayerId) return null;

    const name = players.find((p) => p.id === res.targetPlayerId)?.nickname || "Unknown";
    return (
      <div className="mt-3 bg-slate-900 border border-slate-700 rounded-xl p-3">
        <p className="text-sm">
          Tekshiruv natijasi: <span className="font-semibold">{name}</span> —{" "}
          <span className="font-bold">{res.isMafia ? "MAFIA 😈" : "TINCH 🙂"}</span>
        </p>
      </div>
    );
  }, [isKomissar, room, players]);

  // online indicator
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

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Room</h2>
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

        {/* TIMER */}
        {room?.status === "playing" && room?.phase !== "ended" && timeLeftSec !== null && (
          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-300">Phase</p>
              <p className="font-semibold text-lg">{room.phase.toUpperCase()}</p>
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

        {/* DAY INFO */}
        {room?.status === "playing" && room?.phase === "day" && (
          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <p className="font-semibold text-lg">☀️ Day Phase</p>
            <p className="text-sm text-slate-300 mt-2">
              Kechasi o‘lgan o‘yinchi: <span className="font-bold">{killedName}</span>
            </p>
            {checkBox}
          </div>
        )}

        {/* NIGHT ACTION */}
        {room?.status === "playing" && room?.phase === "night" && (
          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <p className="font-semibold text-lg">🌙 Night Phase</p>

            {(isMafiaPlayer || isDoctor || isKomissar) ? (
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
                          "p-3 rounded-2xl border text-left " +
                          (targetId === p.id
                            ? "bg-white text-slate-900 border-white"
                            : "bg-slate-900 border-slate-700 hover:opacity-90")
                        }
                      >
                        <p className="font-semibold flex items-center gap-2">
                          {p.nickname}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700">
                            {onlineSet.has(p.id) ? "online" : "offline"}
                          </span>
                        </p>
                        <p className="text-xs opacity-70">{p.avatar}</p>
                      </button>
                    ))}
                </div>

                <button
                  onClick={onSubmitNight}
                  className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-slate-900 font-semibold"
                >
                  Submit Action
                </button>
              </>
            ) : (
              <p className="mt-3 text-slate-300">Siz kechasi action qilmaydigan roldasiz. Kuting...</p>
            )}
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
                          "p-3 rounded-2xl border text-left " +
                          (targetId === p.id
                            ? "bg-white text-slate-900 border-white"
                            : "bg-slate-900 border-slate-700 hover:opacity-90")
                        }
                      >
                        <p className="font-semibold">{p.nickname}</p>
                        <p className="text-xs opacity-70">{p.avatar}</p>
                      </button>
                    ))}
                </div>

                <button
                  onClick={onSubmitVote}
                  className="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-slate-900 font-semibold"
                >
                  Submit Vote
                </button>

                <p className="mt-3 text-xs text-slate-400">
                  Sizning hozirgi ovozingiz:{" "}
                  <span className="font-semibold">
                    {myVoteTarget ? (players.find((p) => p.id === myVoteTarget)?.nickname || "Unknown") : "yo‘q"}
                  </span>
                </p>
              </>
            )}
          </div>
        )}

        {/* vote result */}
        {room?.status === "playing" && room?.vote?.resolved && room?.phase === "night" && (
          <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
            <p className="font-semibold">Vote Result</p>
            <p className="text-sm text-slate-300 mt-2">
              Chiqib ketgan o‘yinchi: <span className="font-bold">{eliminatedName}</span>
            </p>
          </div>
        )}

        {/* PLAYERS LIST + HOST KICK */}
        <div className="mt-4 bg-slate-800 border border-slate-700 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold">Players</p>
            <span className="text-sm text-slate-300">{players.length} ta</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {players.map((p) => (
              <div
                key={p.id}
                className={
                  "border rounded-2xl p-3 flex items-center justify-between " +
                  (p.isAlive ? "bg-slate-900 border-slate-700" : "bg-rose-900/30 border-rose-700")
                }
              >
                <div>
                  <p className="font-semibold flex items-center gap-2">
                    {p.nickname} {!p.isAlive ? "💀" : ""}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700">
                      {onlineSet.has(p.id) ? "online" : "offline"}
                    </span>
                    {p.isKicked && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500 text-slate-900">
                        kicked
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">{p.avatar}</p>
                </div>

                {isHost && p.id !== playerId && !p.isKicked && (
                  <button
                    onClick={() => onKick(p.id)}
                    className="px-3 py-2 rounded-xl bg-rose-500 text-slate-900 font-semibold"
                  >
                    Kick
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* AVATAR */}
          <div className="mt-6">
            <p className="font-semibold mb-2">Choose avatar</p>
            <div className="flex flex-wrap gap-2">
              {avatars.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={
                    "px-3 py-2 rounded-xl border text-sm " +
                    (me?.avatar === a
                      ? "bg-white text-slate-900 border-white"
                      : "bg-slate-900 border-slate-700 hover:opacity-90")
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* READY + START */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={toggleReady}
              disabled={!me || room?.status === "playing" || room?.status === "ended"}
              className="w-full px-4 py-2 rounded-xl bg-emerald-500 text-slate-900 font-semibold disabled:opacity-50"
            >
              {me?.isReady ? "Unready" : "Ready"}
            </button>

            {isHost && (
              <button
                onClick={onStartGame}
                disabled={!allReady || room?.status === "playing" || room?.status === "ended"}
                className="w-full px-4 py-2 rounded-xl bg-purple-500 text-slate-900 font-semibold disabled:opacity-50"
              >
                Start Game
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
