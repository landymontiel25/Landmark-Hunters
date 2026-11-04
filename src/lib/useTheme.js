import { useEffect, useState } from 'react';

// Light is the default for everyone (owner, 2026-11-04). New key: the old
// 'lh-theme' held 'dark' for anyone who had opened Settings (it saved the
// old default), so reading it would keep most people in dark.
const STORAGE_KEY = 'lh-theme-v2';

export function getInitialTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Called once at startup (main.jsx). The saved choice used to be applied only
// while Settings was mounted, so every other screen ignored it after a reload
// and Settings claimed "Light mode is on" over a dark app.
export function applyStoredTheme() {
  document.documentElement.setAttribute('data-theme', getInitialTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage blocked (private window) -- the choice just won't persist.
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
