import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/ux-1.css';
import './styles/ux-2.css';
import './styles/ux-3.css';
import App from './App.jsx';
import { capturePendingReferralFromUrl } from './lib/referrals';
import { registerOfflineServiceWorker } from './lib/offlineMap';
import { watchForNewVersion } from './lib/versionCheck';
import { applyStoredTheme } from './lib/useTheme';

// Before HashRouter takes over the URL -- ?ref=... lives in the real query
// string, ahead of the # it routes on.
applyStoredTheme();
capturePendingReferralFromUrl();
registerOfflineServiceWorker();
watchForNewVersion();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
