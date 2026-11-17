import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';
import { dayKey } from './streaks';

// Landmark missions (owner, 2026-11-16; the Abacos first). A landmark's
// `mission` is { type: 'trivia' | 'photo', text, ... }. Trivia is answered
// once per account and checked by the server (api/_lib/missionAnswer.js,
// +10 for the right answer). Photo missions are checked on the phone
// (lib/missionPhoto.js). What you've done is also kept on this device, so
// the card shows it straight away.

export const TRIVIA_PROMPT = "Multiple-choice question: Let's give 10 extra points right now for any multiple-choice question answer.";

export const missionOf = (landmark) => {
  const m = landmark?.mission || landmark?.landmark?.mission;
  return m && typeof m.text === 'string' && (m.type === 'trivia' || m.type === 'photo') ? m : null;
};

const storeKey = (uid) => `lh.missions.${uid || 'guest'}`;
function readAll(uid) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(uid)) || '{}') || {};
  } catch {
    return {};
  }
}
export function missionDone(uid, landmarkId) {
  return readAll(uid)[landmarkId] || null;
}
export function markMissionDone(uid, landmarkId, result) {
  try {
    const all = readAll(uid);
    all[landmarkId] = { ...result, at: Date.now() };
    localStorage.setItem(storeKey(uid), JSON.stringify(all));
  } catch {
    // Private mode: the server still has trivia answers.
  }
}

// { correct, awarded, answer, picked } or throws with a userMessage.
export async function submitMissionAnswer(landmark, answer) {
  const regionId = landmark?.regionId || landmark?.region;
  const r = await fetch(`${API_BASE}/api/mission-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ regionId, landmarkId: landmark.id, answer, dayId: dayKey(new Date()) }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.ok) {
    const err = new Error(data?.error || "Couldn't check your answer. Try again.");
    err.userMessage = err.message;
    throw err;
  }
  if (data.reason === 'no-checkin') {
    const err = new Error('Check in here first, then answer.');
    err.userMessage = err.message;
    throw err;
  }
  return data;
}
