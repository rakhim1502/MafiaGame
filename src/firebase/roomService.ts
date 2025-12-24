import {
  addDoc,
  collection,
  getDocs,
  getDoc,
  limit,
  query,
  serverTimestamp,
  where,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import type { Unsubscribe } from "firebase/firestore";
import { db } from "./firebase.config";

function generateRoomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isMafiaRole(role: string) {
  return role === "mafia" || role === "don";
}

function calcWinner(players: any[]) {
  const alive = players.filter((p) => p.isAlive);
  const mafiaAlive = alive.filter((p) => isMafiaRole(p.role)).length;
  const townAlive = alive.length - mafiaAlive;

  if (mafiaAlive === 0) return "town";
  if (mafiaAlive >= townAlive) return "mafia";
  return null;
}

// ---------- TIMER HELPERS ----------
export function computeEndsAtMs(durationSec: number) {
  return Date.now() + durationSec * 1000;
}

// ---------- PLAYER CONNECTION ----------
export async function setPlayerConnection(roomId: string, playerId: string, isConnected: boolean) {
  await updateDoc(doc(db, "rooms", roomId, "players", playerId), {
    isConnected,
    lastSeenAtMs: Date.now(),
    lastSeenAt: serverTimestamp(),
  });
}

export async function heartbeat(roomId: string, playerId: string) {
  await updateDoc(doc(db, "rooms", roomId, "players", playerId), {
    isConnected: true,
    lastSeenAtMs: Date.now(),
    lastSeenAt: serverTimestamp(),
  });
}

export async function ensurePlayerExists(roomId: string, playerId: string) {
  const ref = doc(db, "rooms", roomId, "players", playerId);
  const snap = await getDoc(ref);
  return snap.exists();
}

// ✅ AUTO REJOIN (reconnect)
// Agar localStorage'da playerId bor-u, doc yo‘q bo‘lsa -> qayta join qilib yangi player yaratadi.
// nickname/avatar ni localStorage’dan oladi (agar bor bo‘lsa).
export async function autoRejoinIfNeeded(params: {
  roomId: string;
  code: string;
  nicknameFallback: string;
  avatarFallback: string;
}) {
  const { roomId, code, nicknameFallback, avatarFallback } = params;

  const storedPlayerId = localStorage.getItem(`playerId_${code}`);
  if (!storedPlayerId) return { playerId: null, didRejoin: false };

  const exists = await ensurePlayerExists(roomId, storedPlayerId);
  if (exists) {
    await setPlayerConnection(roomId, storedPlayerId, true);
    return { playerId: storedPlayerId, didRejoin: false };
  }

  // doc topilmadi -> qayta join
  const nick = localStorage.getItem(`nickname_${code}`) || nicknameFallback;
  const avatar = localStorage.getItem(`avatar_${code}`) || avatarFallback;

  const playerRef = await addDoc(collection(db, "rooms", roomId, "players"), {
    nickname: nick,
    avatar,
    isReady: false,
    isAlive: true,
    role: "unknown",
    isConnected: true,
    isKicked: false,
    lastSeenAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });

  localStorage.setItem(`playerId_${code}`, playerRef.id);
  await setPlayerConnection(roomId, playerRef.id, true);

  return { playerId: playerRef.id, didRejoin: true };
}

// ------- CREATE ROOM -------
export async function createRoom(nickname: string) {
  const code = generateRoomCode();

  const roomRef = await addDoc(collection(db, "rooms"), {
    code,
    status: "lobby",
    phase: "lobby",
    dayNumber: 0,
    createdAt: serverTimestamp(),
    ownerNickname: nickname,
    phaseEndsAtMs: null,
    winner: null,
  });

  const playerRef = await addDoc(collection(db, "rooms", roomRef.id, "players"), {
    nickname,
    avatar: "avatar_1",
    isReady: false,
    isAlive: true,
    role: "unknown",
    isConnected: true,
    isKicked: false,
    lastSeenAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "rooms", roomRef.id), {
    ownerPlayerId: playerRef.id,
  });

  localStorage.setItem(`playerId_${code}`, playerRef.id);
  localStorage.setItem(`roomId_${code}`, roomRef.id);
  localStorage.setItem(`nickname_${code}`, nickname);
  localStorage.setItem(`avatar_${code}`, "avatar_1");

  return { roomId: roomRef.id, code };
}

// ------- FIND ROOM BY CODE -------
export async function findRoomByCode(code: string) {
  const q = query(collection(db, "rooms"), where("code", "==", code), limit(1));
  const snap = await getDocs(q);

  if (snap.empty) return null;

  const d = snap.docs[0];
  return { roomId: d.id, ...(d.data() as any) };
}

// ------- JOIN ROOM -------
export async function joinRoom(roomId: string, code: string, nickname: string) {
  const playerRef = await addDoc(collection(db, "rooms", roomId, "players"), {
    nickname,
    avatar: "avatar_1",
    isReady: false,
    isAlive: true,
    role: "unknown",
    isConnected: true,
    isKicked: false,
    lastSeenAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });

  localStorage.setItem(`playerId_${code}`, playerRef.id);
  localStorage.setItem(`roomId_${code}`, roomId);
  localStorage.setItem(`nickname_${code}`, nickname);
  localStorage.setItem(`avatar_${code}`, "avatar_1");
}

// ------- REALTIME LISTENERS -------
export function listenRoomById(roomId: string, cb: (room: any) => void): Unsubscribe {
  return onSnapshot(doc(db, "rooms", roomId), (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export function listenPlayers(roomId: string, cb: (players: any[]) => void): Unsubscribe {
  const q = query(collection(db, "rooms", roomId, "players"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    const players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(players);
  });
}

// ------- UPDATE PLAYER (READY/AVATAR) -------
export async function updatePlayer(
  roomId: string,
  playerId: string,
  data: Partial<{ avatar: string; isReady: boolean }>
) {
  // avatar localStorage ham yangilansin (reconnect uchun)
  if (data.avatar) {
    // room code bizda yo‘q, shuning uchun Room.tsx’dan saqlaymiz
  }
  await updateDoc(doc(db, "rooms", roomId, "players", playerId), data);
}

// ✅ Host kick (faqat host chaqiradi)
export async function kickPlayer(roomId: string, targetPlayerId: string) {
  await updateDoc(doc(db, "rooms", roomId, "players", targetPlayerId), {
    isKicked: true,
    isConnected: false,
    kickedAt: serverTimestamp(),
  });
}

// ✅ Host remove (lobbyda “soft delete”: player chiqib ketgan kabi)
export async function removePlayer(roomId: string, targetPlayerId: string) {
  await updateDoc(doc(db, "rooms", roomId, "players", targetPlayerId), {
    isConnected: false,
    leftAt: serverTimestamp(),
  });
}

// ------- START GAME (ROLES + PHASE) -------
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRoles(count: number) {
  let mafiaCount = 1;
  if (count >= 6) mafiaCount = 2;
  if (count >= 9) mafiaCount = 3;

  const roles: string[] = [];
  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  if (count >= 9) roles.push("don");

  roles.push("komissar");
  roles.push("doctor");

  while (roles.length < count) roles.push("citizen");

  return shuffle(roles);
}

export async function startGame(roomId: string, nightDurationSec = 60) {
  const q = query(collection(db, "rooms", roomId, "players"), orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  const players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (players.length < 4) throw new Error("Kamida 4 ta o‘yinchi kerak");

  const roles = buildRoles(players.length);
  const shuffledPlayers = shuffle(players);

  const batch = writeBatch(db);

  shuffledPlayers.forEach((p, idx) => {
    batch.update(doc(db, "rooms", roomId, "players", p.id), {
      role: roles[idx],
      isAlive: true,
      isReady: false,
      isKicked: false,
    });
  });

  batch.update(doc(db, "rooms", roomId), {
    status: "playing",
    phase: "night",
    dayNumber: 0,
    startedAt: serverTimestamp(),
    night: {},
    day: {},
    vote: {},
    winner: null,
    phaseEndsAtMs: computeEndsAtMs(nightDurationSec),
  });

  await batch.commit();
}

// ------- NIGHT ACTIONS (SUBMIT) -------
export async function submitNightAction(params: {
  roomId: string;
  role: "mafia" | "don" | "doctor" | "komissar";
  actorPlayerId: string;
  targetPlayerId: string;
}) {
  const { roomId, role, actorPlayerId, targetPlayerId } = params;
  const roomRef = doc(db, "rooms", roomId);

  if (role === "mafia" || role === "don") {
    await updateDoc(roomRef, {
      "night.killTargetId": targetPlayerId,
      "night.killBy": actorPlayerId,
      "night.submittedKill": true,
      "night.updatedAt": serverTimestamp(),
    });
  }

  if (role === "doctor") {
    await updateDoc(roomRef, {
      "night.saveTargetId": targetPlayerId,
      "night.saveBy": actorPlayerId,
      "night.submittedSave": true,
      "night.updatedAt": serverTimestamp(),
    });
  }

  if (role === "komissar") {
    await updateDoc(roomRef, {
      "night.checkTargetId": targetPlayerId,
      "night.checkBy": actorPlayerId,
      "night.submittedCheck": true,
      "night.updatedAt": serverTimestamp(),
    });
  }
}

// ------- NIGHT RESOLVE (HOST) -------
export async function resolveNight(roomId: string, dayDurationSec = 60) {
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room topilmadi");

  const room = roomSnap.data() as any;

  const night = room.night || {};
  const killTargetId = night.killTargetId as string | undefined;
  const saveTargetId = night.saveTargetId as string | undefined;
  const checkTargetId = night.checkTargetId as string | undefined;

  const q = query(collection(db, "rooms", roomId, "players"), orderBy("createdAt", "asc"));
  const ps = await getDocs(q);
  const players = ps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  let checkResult: null | { targetPlayerId: string; isMafia: boolean } = null;
  if (checkTargetId) {
    const target = players.find((p) => p.id === checkTargetId);
    if (target) {
      checkResult = { targetPlayerId: checkTargetId, isMafia: isMafiaRole(target.role) };
    }
  }

  let killedPlayerId: string | null = null;
  if (killTargetId && killTargetId !== saveTargetId) {
    killedPlayerId = killTargetId;
  }

  const batch = writeBatch(db);

  if (killedPlayerId) {
    batch.update(doc(db, "rooms", roomId, "players", killedPlayerId), {
      isAlive: false,
    });
  }

  const playersAfter = players.map((p) =>
    p.id === killedPlayerId ? { ...p, isAlive: false } : p
  );
  const winner = calcWinner(playersAfter);

  if (winner) {
    batch.update(roomRef, {
      status: "ended",
      winner,
      phase: "ended",
      phaseEndsAtMs: null,
      "day.lastCheckResult": checkResult,
      night: {
        resolvedAt: serverTimestamp(),
        lastKilledPlayerId: killedPlayerId,
        lastSavedPlayerId: saveTargetId ?? null,
      },
    });
  } else {
    batch.update(roomRef, {
      phase: "day",
      phaseEndsAtMs: computeEndsAtMs(dayDurationSec),
      dayNumber: (room.dayNumber ?? 0) + 1,
      "day.lastCheckResult": checkResult,
      night: {
        resolvedAt: serverTimestamp(),
        lastKilledPlayerId: killedPlayerId,
        lastSavedPlayerId: saveTargetId ?? null,
      },
      vote: {},
    });
  }

  await batch.commit();
}

// ------- VOTE: START (HOST) -------
export async function startVote(roomId: string, voteDurationSec = 45) {
  await updateDoc(doc(db, "rooms", roomId), {
    phase: "vote",
    phaseEndsAtMs: computeEndsAtMs(voteDurationSec),
    vote: {
      startedAt: serverTimestamp(),
      votes: {},
      resolved: false,
    },
  });
}

// ------- VOTE: SUBMIT -------
export async function submitVote(params: {
  roomId: string;
  voterPlayerId: string;
  targetPlayerId: string;
}) {
  const { roomId, voterPlayerId, targetPlayerId } = params;
  await updateDoc(doc(db, "rooms", roomId), {
    [`vote.votes.${voterPlayerId}`]: targetPlayerId,
    "vote.updatedAt": serverTimestamp(),
  });
}

// ------- VOTE: RESOLVE (HOST) -------
export async function resolveVote(roomId: string, nightDurationSec = 60) {
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room topilmadi");

  const room = roomSnap.data() as any;
  const votesObj = (room.vote?.votes || {}) as Record<string, string>;

  const q = query(collection(db, "rooms", roomId, "players"), orderBy("createdAt", "asc"));
  const ps = await getDocs(q);
  const players = ps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const aliveIds = new Set(players.filter((p) => p.isAlive).map((p) => p.id));

  const tally: Record<string, number> = {};
  for (const [voterId, targetId] of Object.entries(votesObj)) {
    if (!aliveIds.has(voterId)) continue;
    if (!aliveIds.has(targetId)) continue;
    tally[targetId] = (tally[targetId] || 0) + 1;
  }

  let eliminatedId: string | null = null;
  let max = 0;
  let tie = false;

  for (const [targetId, count] of Object.entries(tally)) {
    if (count > max) {
      max = count;
      eliminatedId = targetId;
      tie = false;
    } else if (count === max && count !== 0) {
      tie = true;
    }
  }

  if (tie) eliminatedId = null;

  const batch = writeBatch(db);

  if (eliminatedId) {
    batch.update(doc(db, "rooms", roomId, "players", eliminatedId), { isAlive: false });
  }

  const playersAfter = players.map((p) =>
    p.id === eliminatedId ? { ...p, isAlive: false } : p
  );
  const winner = calcWinner(playersAfter);

  if (winner) {
    batch.update(roomRef, {
      status: "ended",
      winner,
      phase: "ended",
      phaseEndsAtMs: null,
      "vote.resolvedAt": serverTimestamp(),
      "vote.eliminatedPlayerId": eliminatedId,
      "vote.resolved": true,
    });
  } else {
    batch.update(roomRef, {
      phase: "night",
      phaseEndsAtMs: computeEndsAtMs(nightDurationSec),
      night: {},
      "vote.resolvedAt": serverTimestamp(),
      "vote.eliminatedPlayerId": eliminatedId,
      "vote.resolved": true,
    });
  }

  await batch.commit();
}
