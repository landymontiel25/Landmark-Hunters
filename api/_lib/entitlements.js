// Pro (owner, 2026-11-24: unlimited offline check-ins). The app has no
// purchases yet, so Pro is a server-only flag: entitlements/{uid}.pro,
// which only the Admin SDK writes (firestore.rules: the owner may read it).
export async function isPro(db, uid) {
  try {
    const snap = await db.collection('entitlements').doc(uid).get();
    return snap.exists && snap.data()?.pro === true;
  } catch {
    return false;
  }
}
