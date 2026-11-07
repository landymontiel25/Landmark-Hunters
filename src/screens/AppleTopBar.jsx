import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useHeaderStats, pillName } from '../lib/useHeaderStats';

// Test tab "UI": the one top bar every Apple-style screen shares (Map,
// Landmarks, Itinerary, Profile): the wordmark on one line, your streak, your
// points, and your name with a dropdown chevron. All read-only mirrors of the
// app header; taps go where the header's go.
export default function AppleTopBar({ className = '' }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const stats = useHeaderStats();
  return (
    <header className={`ap-top ${className}`}>
      <h1 className="ap-brand">Landmark Hunters</h1>
      <div className="ap-top-right">
        <button type="button" className="ap-chip ap-stat" aria-label={`${stats.streak}-day streak`} onClick={() => navigate('/streaks')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="ap-flame">
            <path d="M12 2.5c.6 3.2-1.4 4.6-2.8 6.4C7.7 10.8 7 12.3 7 14a5 5 0 0 0 10 0c0-1.9-.8-3.1-1.7-4.2-.3 1.2-1 2-1.9 2.3.5-3.3-.1-7.2-1.4-9.6z" />
          </svg>
          {stats.streak}
        </button>
        <button type="button" className="ap-chip ap-stat" aria-label="Standings" onClick={() => navigate('/leaderboard/full')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3 3 0 0 0 7 10.5M17 6h3v1.5a3 3 0 0 1-3 3M12 14v4M8.5 20h7" />
          </svg>
          {stats.points == null ? '–' : stats.points.toLocaleString()}
        </button>
        <button type="button" className="ap-chip ap-user" aria-label="Profile" onClick={() => navigate('/profile')}>
          <span className="ap-user-name">{pillName(user)}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
