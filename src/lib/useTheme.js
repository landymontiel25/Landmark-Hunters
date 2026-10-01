import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lh-theme';

// The app's stylesheet is dark unless [data-theme='light'] is set, so dark is
// the default until the traveler picks light in Settings.
export function getInitialTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
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
