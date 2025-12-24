import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, findRoomByCode, joinRoom } from "../firebase/roomService";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const nav = useNavigate();

  async function handleCreate() {
    if (!nickname.trim()) return alert("Nickname kiriting");
    setLoading(true);
    try {
      const { code } = await createRoom(nickname.trim());
      nav(`/room/${code}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!nickname.trim()) return alert("Nickname kiriting");
    if (!code.trim()) return alert("Room code kiriting");

    setLoading(true);
    try {
      const room = await findRoomByCode(code.trim());
      if (!room) return alert("Bunaqa room topilmadi");

      // ✅ joinRoom endi (roomId, code, nickname)
      await joinRoom(room.roomId, room.code, nickname.trim());
      nav(`/room/${room.code}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-800 rounded-2xl p-6 shadow">
        <h1 className="text-3xl font-bold mb-2">Mafia Game 🎭</h1>
        <p className="text-slate-300 mb-6">Create room yoki code bilan join qiling</p>

        <label className="text-sm text-slate-300">Nickname</label>
        <input
          className="w-full mt-1 mb-4 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 outline-none"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Masalan: Aziz"
        />

        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-white text-slate-900 font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Create Room"}
        </button>

        <div className="my-5 border-t border-slate-700" />

        <label className="text-sm text-slate-300">Room Code</label>
        <input
          className="w-full mt-1 mb-4 px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 outline-none"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="6 xonali kod"
        />

        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-emerald-500 text-slate-900 font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Join Room"}
        </button>
      </div>
    </div>
  );
}
