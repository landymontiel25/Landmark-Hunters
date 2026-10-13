import { useState } from 'react';
import { msUntilStreakLapse } from './streaks';
import { useVisibleInterval } from './useVisibleInterval';

// The solo streak only warns you in the last 5 hours of your local day
// (owner, 2026-10-13): the banner, the notification, the red header flame and
// Profile's red line. Earlier in the day an unsecured streak shows nothing red.
export const STREAK_WARNING_WINDOW_MS = 5 * 60 * 60 * 1000;

export const inStreakWarningWindow = (now = new Date()) => msUntilStreakLapse(now) <= STREAK_WARNING_WINDOW_MS;

// Re-checked every 30 seconds while the page is visible.
export function useInStreakWarningWindow() {
  const [inWindow, setInWindow] = useState(() => inStreakWarningWindow());
  useVisibleInterval(() => setInWindow(inStreakWarningWindow()), 30000, true);
  return inWindow;
}
