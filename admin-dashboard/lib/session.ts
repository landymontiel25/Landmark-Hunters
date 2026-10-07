// A 401 from the dashboard's own API means the session cookie expired (or was
// cleared): proxy.ts answers "Sign in first." Background polling would show
// that forever, so the page goes to /login instead.
export const sessionNav = {
  toLogin: () => {
    if (typeof window !== 'undefined') window.location.assign('/login');
  },
};

// True (and navigates to /login) when `status` says the session is gone.
export function redirectIfSignedOut(status: number): boolean {
  if (status !== 401) return false;
  sessionNav.toLogin();
  return true;
}
