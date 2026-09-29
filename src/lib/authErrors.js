const MESSAGES = {
  'auth/invalid-credential': "That email/password combo doesn't match an account — double-check them, or if you originally signed in with Google, use \"Continue with Google\" instead (Google accounts don't have a password here).",
  'auth/wrong-password': "That password doesn't match — double-check it, or tap \"Forgot password?\".",
  'auth/user-not-found': "There's no account with that email yet — tap \"New here? Create an Account\" to make one.",
  'auth/email-already-in-use': 'An account already exists with that email — try signing in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': "That doesn't look like a valid email address.",
  'auth/missing-email': 'Type your email address first.',
  'auth/missing-password': 'Type your password first.',
  'auth/user-disabled': 'This account has been disabled. Contact support if you think that is a mistake.',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
  'auth/too-many-requests': 'Too many attempts — wait a bit before trying again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled before it finished — try again.',
  'auth/requires-recent-login': 'For your security, sign out and back in, then try that again.',
  'auth/unauthorized-domain': 'Google Sign-In is not configured for this domain yet. Please try again in a moment.',
  'auth/operation-not-supported-in-this-environment': 'Google Sign-In is not available in this browser. Try using a different browser or device.',
  'auth/timeout': "Sign-in is taking too long — check your connection and try again.",
  'auth/internal-error': 'Something went wrong on our end — try again in a moment.',
};

// Never shows Firebase's own "Firebase: Error (auth/...)" text -- an
// unmapped code falls back to a plain sentence instead.
export function authErrorMessage(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return "You're offline — reconnect and try again.";
  }
  return MESSAGES[err?.code] || 'Something went wrong — try again in a moment.';
}
