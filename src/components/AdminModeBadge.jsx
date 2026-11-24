import { useNavigate } from 'react-router-dom';
import { useAdminMode } from '../lib/AdminModeContext';

// A constant, impossible-to-miss reminder that Admin Mode is on -- every
// screen, not just Settings/landmark pages, since it's easy to forget you
// left it on and then be confused why editing a landmark's page looks
// different. Tapping it opens Admin Mode (the admin panel, owner
// 2026-11-23), where its one switch is; it isn't rendered once it's off.
export default function AdminModeBadge() {
  const navigate = useNavigate();
  const { adminMode } = useAdminMode();

  if (!adminMode) return null;

  return (
    <button
      type="button"
      className="admin-mode-badge"
      title="Admin Mode is on. Tap to open it."
      onClick={() => navigate('/admin')}
    >
      <span className="admin-mode-badge-star" aria-hidden="true">
        {'★'}
      </span>
      Admin Mode On
    </button>
  );
}
