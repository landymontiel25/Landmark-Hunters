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

// A photo mission's photo, already saved on this visit's check-in: the
// server checks it shows what the mission asks (api/_lib/missionPhoto.js)
// and pays +10 the first time one does. { passed, awarded, reason, why } or
// throws with a userMessage when the check couldn't run.
export async function submitMissionPhoto(landmark, photoURL) {
  const regionId = landmark?.regionId || landmark?.region;
  let r;
  let data = null;
  try {
    r = await fetch(`${API_BASE}/api/mission-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ regionId, landmarkId: landmark.id, photoURL, dayId: dayKey(new Date()) }),
    });
    data = await r.json().catch(() => null);
  } catch {
    r = null;
  }
  if (!r?.ok || !data?.ok || data.reason === 'check-failed') {
    const err = new Error("Couldn't check your photo just now. Try again.");
    err.userMessage = err.message;
    throw err;
  }
  if (data.reason === 'no-checkin') {
    const err = new Error('Check in here first, then take the mission photo.');
    err.userMessage = err.message;
    throw err;
  }
  return data;
}
