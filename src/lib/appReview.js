// Asks Apple for its own review prompt (owner, 2026-11-15). App Store rules
// allow only the system prompt: SKStoreReviewController / AppStore.requestReview,
// via @capacitor-community/in-app-review. Apple decides whether it actually
// appears (at most a few times a year per person), and never says whether
// someone rated, so there's nothing to wait for. On the web there's no system
// prompt: it returns { shown: false, reason: 'web' }.
import { Capacitor } from '@capacitor/core';

export async function requestAppReview() {
  if (!Capacitor.isNativePlatform()) return { shown: false, reason: 'web' };
  try {
    const { InAppReview } = await import('@capacitor-community/in-app-review');
    await InAppReview.requestReview();
    return { shown: true };
  } catch {
    return { shown: false, reason: 'error' };
  }
}
