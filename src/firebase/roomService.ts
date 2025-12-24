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

// ---------- EVENTS (LOG) ----------
export async function addEvent(params: {
  roomId: string;
  type: string;
  text: string;
  phase?: string | null;
  dayNumber?: number | null;
}) {
  const { roomId, type, text, phase, dayNumber } = params;

  await addDoc(collection(db, "rooms", roomId, "events"), {
    type,
    text,
    phase: phase ?? null,
    dayNumber: dayNumber ?? null,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

export function listenEvents(roomId: string, cb: (events: any[]) => void): Unsubscribe {
  const q = query(collection(db, "rooms", roomId, "events"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ---------- CHAT ----------
export async function sendMessage(params: {
  roomId: string;
  senderId: string;
  senderNick: string;
  text: string;
  scope: "lobby" | "public" | "mafia";
}) {
  const { roomId, senderId, senderNick, text, scope } = params;

  const clean = text.trim();
  if (!clean) return;

  await addDoc(collection(db, "rooms", roomId, "messages"), {
    senderId,
    senderNick,
    text: clean.slice(0, 300),
    scope,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

export function listenMessages(roomId: string, cb: (msgs: any[]) => void): Unsubscribe {
  const q = query(collection(db, "rooms", roomId, "messages"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ---------- HOST SETTINGS ----------
export async function updateRoomSettings(
  roomId: string,
  settings: Partial<{ nightSec: number; daySec: number; voteSec: number }>
) {
  const roomRef = doc(db, "rooms", roomId);
  const snap = await getDoc(roomRef);
  const prev = snap.exists() ? ((snap.data() as any).settings || {}) : {};

  await updateDoc(roomRef, {
    settings: {
      ...prev,
      ...settings,
      updatedAt: serverTimestamp(),
    },
  });
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
    nightSubmitted: false,
    voteSubmitted: false,
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
    ownerPlayerId: null,
    phaseEndsAtMs: null,
    winner: null,
    settings: {
      nightSec: 60,
      daySec: 60,
      voteSec: 45,
    },
  });

  const playerRef = await addDoc(collection(db, "rooms", roomRef.id, "players"), {
    nickname,
    avatar: "avatar_1",
    isReady: false,
    isAlive: true,
    role: "unknown",
    isConnected: true,
    isKicked: false,
    nightSubmitted: false,
    voteSubmitted: false,
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

  await addEvent({
    roomId: roomRef.id,
    type: "room_created",
    text: `Room created by ${nickname}`,
    phase: "lobby",
    dayNumber: 0,
  });

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
    nightSubmitted: false,
    voteSubmitted: false,
    lastSeenAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });

  localStorage.setItem(`playerId_${code}`, playerRef.id);
  localStorage.setItem(`roomId_${code}`, roomId);
  localStorage.setItem(`nickname_${code}`, nickname);
  localStorage.setItem(`avatar_${code}`, "avatar_1");

  await addEvent({
    roomId,
    type: "player_joined",
    text: `${nickname} joined`,
    phase: "lobby",
  });
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
  await updateDoc(doc(db, "rooms", roomId, "players", playerId), data);
}

// ✅ Host kick
export async function kickPlayer(roomId: string, targetPlayerId: string) {
  await updateDoc(doc(db, "rooms", roomId, "players", targetPlayerId), {
    isKicked: true,
    isConnected: false,
    kickedAt: serverTimestamp(),
  });

  await addEvent({
    roomId,
    type: "player_kicked",
    text: `Player kicked`,
    phase: "lobby",
  });
}

// ✅ Host remove
export async function removePlayer(roomId: string, targetPlayerId: string) {
  await updateDoc(doc(db, "rooms", roomId, "players", targetPlayerId), {
    isConnected: false,
    leftAt: serverTimestamp(),
  });

  await addEvent({
    roomId,
    type: "player_removed",
    text: `Player removed`,
    phase: "lobby",
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

export async function startGame(roomId: string, nightDurationSec?: number) {
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  const room = roomSnap.exists() ? (roomSnap.data() as any) : null;

  const nightSec = nightDurationSec ?? room?.settings?.nightSec ?? 60;

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
      nightSubmitted: false,
      voteSubmitted: false,
      private: {}, // komissar natija shu yerga tushadi
    });
  });

  batch.update(roomRef, {
    status: "playing",
    phase: "night",
    dayNumber: 0,
    startedAt: serverTimestamp(),
    night: {},
    day: {},
    vote: {},
    winner: null,
    phaseEndsAtMs: computeEndsAtMs(nightSec),
  });

  await batch.commit();

  await addEvent({
    roomId,
    type: "game_started",
    text: "Game started",
    phase: "night",
    dayNumber: 0,
  });
}

// ------- NIGHT ACTIONS (SUBMIT) -------
// ✅ 1 marta: player.nightSubmitted true bo‘lsa qayta yozmaymiz (MVP)
export async function submitNightAction(params: {
  roomId: string;
  role: "mafia" | "don" | "doctor" | "komissar";
  actorPlayerId: string;
  targetPlayerId: string;
}) {
  const { roomId, role, actorPlayerId, targetPlayerId } = params;

  const actorRef = doc(db, "rooms", roomId, "players", actorPlayerId);
  const actorSnap = await getDoc(actorRef);
  if (!actorSnap.exists()) throw new Error("Actor topilmadi");

  const actor = actorSnap.data() as any;
  if (actor.nightSubmitted) throw new Error("Siz actionni yuborgan siz ✅");

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

  // lock
  await updateDoc(actorRef, {
    nightSubmitted: true,
    nightSubmittedAtMs: Date.now(),
  });
}

// ------- NIGHT RESOLVE (HOST) -------
export async function resolveNight(roomId: string, dayDurationSec?: number) {
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room topilmadi");

  const room = roomSnap.data() as any;
  const daySec = dayDurationSec ?? room?.settings?.daySec ?? 60;

  const night = room.night || {};
  const killTargetId = night.killTargetId as string | undefined;
  const saveTargetId = night.saveTargetId as string | undefined;
  const checkTargetId = night.checkTargetId as string | undefined;
  const checkBy = night.checkBy as string | undefined;

  const q = query(collection(db, "rooms", roomId, "players"), orderBy("createdAt", "asc"));
  const ps = await getDocs(q);
  const players = ps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  // ✅ komissar natijasi faqat komissarga yoziladi
  if (checkTargetId && checkBy) {
    const target = players.find((p) => p.id === checkTargetId);
    if (target) {
      await updateDoc(doc(db, "rooms", roomId, "players", checkBy), {
        "private.lastCheckResult": {
          targetId: checkTargetId,
          isMafia: isMafiaRole(target.role),
          at: Date.now(),
        },
      });
    }
  }

  let killedPlayerId: string | null = null;
  if (killTargetId && killTargetId !== saveTargetId) {
    killedPlayerId = killTargetId;
  }

  const batch = writeBatch(db);

  if (killedPlayerId) {
    batch.update(doc(db, "rooms", roomId, "players", killedPlayerId), { isAlive: false });
  }

  // ✅ nightSubmitted reset (next night uchun)
  players.forEach((p) => {
    batch.update(doc(db, "rooms", roomId, "players", p.id), { nightSubmitted: false });
  });

  const playersAfter = players.map((p) => (p.id === killedPlayerId ? { ...p, isAlive: false } : p));
  const winner = calcWinner(playersAfter);

  if (winner) {
    batch.update(roomRef, {
      status: "ended",
      winner,
      phase: "ended",
      phaseEndsAtMs: null,
      night: {
        resolvedAt: serverTimestamp(),
        lastKilledPlayerId: killedPlayerId,
        lastSavedPlayerId: saveTargetId ?? null,
      },
      day: {},
      vote: {},
    });
  } else {
    batch.update(roomRef, {
      phase: "day",
      phaseEndsAtMs: computeEndsAtMs(daySec),
      dayNumber: (room.dayNumber ?? 0) + 1,
      night: {
        resolvedAt: serverTimestamp(),
        lastKilledPlayerId: killedPlayerId,
        lastSavedPlayerId: saveTargetId ?? null,
      },
      day: {},
      vote: {},
    });
  }

  await batch.commit();

  await addEvent({
    roomId,
    type: "night_resolved",
    text: killedPlayerId ? `Night: 1 player died` : `Night: nobody died`,
    phase: winner ? "ended" : "day",
    dayNumber: winner ? room.dayNumber ?? 0 : (room.dayNumber ?? 0) + 1,
  });
}

// ------- VOTE: START (HOST) -------
export async function startVote(roomId: string, voteDurationSec?: number) {
  const roomRef = doc(db, "rooms", roomId);
  const snap = await getDoc(roomRef);
  const room = snap.exists() ? (snap.data() as any) : null;
  const voteSec = voteDurationSec ?? room?.settings?.voteSec ?? 45;

  // voteSubmitted reset (vote boshida)
  const ps = await getDocs(query(collection(db, "rooms", roomId, "players"), orderBy("createdAt", "asc")));
  const batch = writeBatch(db);
  ps.docs.forEach((d) => {
    batch.update(doc(db, "rooms", roomId, "players", d.id), { voteSubmitted: false });
  });


  batch.update(roomRef, {
    phase: "vote",
    phaseEndsAtMs: computeEndsAtMs(voteSec),
    vote: {
      startedAt: serverTimestamp(),
      votes: {},
      resolved: false,
    },
  });

  await batch.commit();

  await addEvent({
    roomId,
    type: "vote_started",
    text: "Vote started",
    phase: "vote",
  });
}

// ------- VOTE: SUBMIT (1 marta) -------
export async function submitVote(params: {
  roomId: string;
  voterPlayerId: string;
  targetPlayerId: string;
}) {
  const { roomId, voterPlayerId, targetPlayerId } = params;

  const voterRef = doc(db, "rooms", roomId, "players", voterPlayerId);
  const voterSnap = await getDoc(voterRef);
  if (!voterSnap.exists()) throw new Error("Voter topilmadi");

  const voter = voterSnap.data() as any;
  if (voter.voteSubmitted) throw new Error("Siz ovoz berib bo‘lgansiz ✅");

  await updateDoc(doc(db, "rooms", roomId), {
    [`vote.votes.${voterPlayerId}`]: targetPlayerId,
    "vote.updatedAt": serverTimestamp(),
  });

  await updateDoc(voterRef, {
    voteSubmitted: true,
    voteSubmittedAtMs: Date.now(),
  });
}

// ------- VOTE: RESOLVE (HOST) -------
export async function resolveVote(roomId: string, nightDurationSec?: number) {
  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room topilmadi");

  const room = roomSnap.data() as any;
  const nightSec = nightDurationSec ?? room?.settings?.nightSec ?? 60;

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

  // voteSubmitted reset (keyingi vote uchun)
  players.forEach((p) => {
    batch.update(doc(db, "rooms", roomId, "players", p.id), { voteSubmitted: false });
  });

  const playersAfter = players.map((p) => (p.id === eliminatedId ? { ...p, isAlive: false } : p));
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
      night: {},
    });
  } else {
    batch.update(roomRef, {
      phase: "night",
      phaseEndsAtMs: computeEndsAtMs(nightSec),
      night: {},
      "vote.resolvedAt": serverTimestamp(),
      "vote.eliminatedPlayerId": eliminatedId,
      "vote.resolved": true,
    });
  }

  await batch.commit();

  await addEvent({
    roomId,
    type: "vote_resolved",
    text: eliminatedId ? "Vote: 1 player eliminated" : "Vote: tie/no elimination",
    phase: winner ? "ended" : "night",
  });
}
