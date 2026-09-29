import { adminDb } from './firebaseAdmin.js';

// One record per Anthropic API call: which feature, which model, and token
// counts -- never any of the user's text, the prompt, or the reply. Written
// as a structured line to the function log (always) and to Firestore
// ai_call_log (best-effort, needs FIREBASE_SERVICE_ACCOUNT; admin-only, no
// client rules). Never throws, and never holds up a reply for long.
//
// isTest marks calls made from admin preview/test surfaces (the Test tab),
// so anything that sums real usage -- Mapr's match rate included -- can
// leave them out with a single `isTest == false` filter.

const FIRESTORE_TIMEOUT_MS = 1500;

export function aiCallEntry({ feature, model, usage, isTest = false }) {
  return {
    feature: String(feature || 'unknown'),
    model: String(model || 'unknown'),
    isTest: isTest === true,
    inputTokens: Number(usage?.input_tokens) || 0,
    outputTokens: Number(usage?.output_tokens) || 0,
    cacheReadInputTokens: Number(usage?.cache_read_input_tokens) || 0,
    cacheCreationInputTokens: Number(usage?.cache_creation_input_tokens) || 0,
    at: new Date().toISOString(),
  };
}

export async function logAiCall({ feature, model, usage, isTest = false }, { db = null } = {}) {
  const entry = aiCallEntry({ feature, model, usage, isTest });
  try {
    console.log(JSON.stringify({ type: 'ai_call', ...entry }));
  } catch {
    /* logging must never break a reply */
  }
  try {
    const store = db || adminDb();
    await Promise.race([
      store.collection('ai_call_log').add(entry),
      new Promise((resolve) => setTimeout(resolve, FIRESTORE_TIMEOUT_MS)),
    ]);
  } catch {
    /* Firestore admin not configured, or the write failed -- the log line above still has it */
  }
  return entry;
}
