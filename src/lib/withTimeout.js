// Rejects with an `auth/timeout` error if `promise` hasn't settled after `ms`,
// so a sign-in call that never answers surfaces as a message in the form
// instead of leaving the button disabled forever. Doesn't cancel the underlying
// request: if it lands late, onAuthStateChanged still signs the person in.
export const AUTH_TIMEOUT_MS = 15000;

export function withTimeout(promise, ms = AUTH_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Timed out');
      err.code = 'auth/timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
