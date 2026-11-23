import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { authHeaders } from './apiAuth';
import { API_BASE } from './apiBase';
import { dayKey } from './streaks';

// Landmark missions (owner, 2026-11-16; the Abacos first). A landmark's
// `mission` is { type: 'trivia' | 'photo', text, ... }. Trivia is answered
// once per account and checked by the server (api/_lib/missionAnswer.js,
// +10 for the right answer); photo missions too (api/_lib/missionPhoto.js).
// Whether a mission is done is the server's record (mission_answers,
// mission_photos; loadServerMission). This device keeps a copy only so the
// card shows straight away; the server's answer replaces it.

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
  if (data?.reason === 'check-limit') {
    const err = new Error("That's all the photo checks for today. Try the mission again tomorrow.");
    err.userMessage = err.message;
    throw err;
  }
  if (!r?.ok || !data?.ok || data.reason === 'check-failed') {
    const err = new Error("Couldn't check your photo just now. Try again.");
    err.userMessage = err.message;
    throw err;
  }
  if (data.reason === 'no-checkin') {
    // Any real check-in opens the mission, but only a location-verified one
    // counts (anti-farming item 1): an older, unverified visit needs a new one.
    const err = new Error("Your check-in here isn't confirmed by location yet. Tap Check In Again at the top while you're here, then take the mission photo.");
    err.userMessage = err.message;
    throw err;
  }
  return data;
}

// This account's mission result here, from the server's record: a trivia
// answer ({ kind: 'trivia', correct, picked }) or a passed photo ({ kind:
// 'photo', awarded }), or null when there is none.
export async function loadServerMission(uid, landmarkId) {
  if (!db || !uid || !landmarkId) return null;
  const id = `${uid}_${landmarkId}`;
  const [a, p] = await Promise.all([
    getDoc(doc(db, 'mission_answers', id)).catch(() => null),
    getDoc(doc(db, 'mission_photos', id)).catch(() => null),
  ]);
  if (a?.exists()) {
    const d = a.data();
    return { kind: 'trivia', correct: !!d.correct, picked: d.answer, answer: d.correct ? d.answer : null };
  }
  if (p?.exists() && p.data().passed) return { kind: 'photo', awarded: Number(p.data().points) || 0 };
  return null;
}

// Replaces this device's copy with the server's record (null clears it).
export function syncMissionDone(uid, landmarkId, result) {
  try {
    const all = readAll(uid);
    if (result) all[landmarkId] = { ...result, at: Date.now() };
    else delete all[landmarkId];
    localStorage.setItem(storeKey(uid), JSON.stringify(all));
  } catch {
    /* private mode */
  }
}
