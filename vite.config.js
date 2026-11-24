import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Agent/worktree copies of the repo live under .claude/; they are not part
    // of this project's suite.
    exclude: [...configDefaults.exclude, '.claude/**', 'admin-dashboard/**'],
    // Full-screen render tests (MapExplore, LandmarkSelection, GroupTrip) take
    // more than the 5 s default whenever the machine is busy, and then fail
    // with a timeout rather than a real error.
    testTimeout: 20000,
    // Points endpoints enforce App Check in production by default; the
    // endpoint tests send no App Check token and exercise everything else.
    env: { APP_CHECK_POINTS_MODE: 'monitor' },
  },
})
