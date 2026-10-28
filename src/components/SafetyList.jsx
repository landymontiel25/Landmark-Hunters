import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useToast, runOptimistic } from '../lib/ToastContext';
import { friendlyError } from '../lib/friendlyError';
import { listBlockedUsers, unblockUser } from '../lib/blocks';
import { listMyReports } from '../lib/myReports';

const KIND_LABEL = { comment: 'Comment', tip: 'Tip', landmark: 'Landmark' };

const when = (ts) => {
  const ms = ts?.toMillis?.() ?? (ts?.seconds ? ts.seconds * 1000 : null);
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

// Settings: who you've blocked (with Unblock) and what you've reported.
export default function SafetyList() {
  const { user } = useAuth();
  const { reload: reloadFriends } = useFriends();
  const toast = useToast();
  const [blocked, setBlocked] = useState(null);
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(false);
    const [b, r] = await Promise.all([listBlockedUsers(user.uid).catch(() => null), listMyReports(user.uid).catch(() => null)]);
    if (b === null && r === null) setError(true);
    setBlocked(b || []);
    setReports(r || []);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const unblock = (b) =>
    runOptimistic({
      apply: () => setBlocked((cur) => cur.filter((x) => x.blockedUid !== b.blockedUid)),
      commit: async () => {
        await unblockUser(user.uid, b.blockedUid);
        reloadFriends?.().catch(() => {});
      },
      rollback: () => setBlocked((cur) => (cur.some((x) => x.blockedUid === b.blockedUid) ? cur : [...cur, b])),
      toast,
      errorMessage: friendlyError(null, `Couldn't unblock ${b.blockedName || 'that user'}. They're still blocked.`),
      retry: () => unblock(b),
    });

  if (!user) return null;
  return (
    <div className="card section" id="blocked-reported">
      <h3 style={{ marginTop: 0 }}>{'\u{1F6E1}\u{FE0F}'} Blocked &amp; Reported</h3>
      <p className="screen-subtitle" style={{ marginTop: -6 }}>
        Only you can see this. People you block or report are never told.
      </p>
      {error && <p className="tag tag-error">Couldn't load this list. Try again later.</p>}

      <h4 style={{ margin: '12px 0 6px' }}>Blocked{blocked ? ` (${blocked.length})` : ''}</h4>
      {blocked && blocked.length === 0 && <p className="screen-subtitle" style={{ margin: 0 }}>No one blocked.</p>}
      {(blocked || []).map((b) => (
        <div key={b.blockedUid} className="friend-row">
          <span>{b.blockedName ? `@${String(b.blockedName).replace(/^@/, '')}` : 'A user'}</span>
          <button type="button" className="btn btn-ghost btn-tight" onClick={() => unblock(b)}>
            Unblock
          </button>
        </div>
      ))}

      <h4 style={{ margin: '16px 0 6px' }}>Reported{reports ? ` (${reports.length})` : ''}</h4>
      {reports && reports.length === 0 && <p className="screen-subtitle" style={{ margin: 0 }}>Nothing reported.</p>}
      {(reports || []).map((r) => (
        <div key={r.id} className="friend-row" style={{ alignItems: 'flex-start' }}>
          <span style={{ minWidth: 0 }}>
            <strong>{KIND_LABEL[r.kind] || 'Report'}</strong>
            {r.label ? `: ${r.label}` : ''}
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{when(r.createdAt)}</span>
          </span>
          {r.landmarkId && r.regionId && (
            <Link className="btn btn-ghost btn-tight" to={`/landmarks/${r.regionId}/${r.landmarkId}`}>
              View
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
