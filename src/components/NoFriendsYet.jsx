// What a friend list shows when you have none yet: upbeat, with what to do
// next, instead of an empty box or a loading skeleton that never fills.
export default function NoFriendsYet({ children }) {
  return (
    <div className="no-friends">
      <span className="no-friends-emoji" aria-hidden="true">
        {'\u{1F44B}'}
      </span>
      <div>
        <strong>No friends here yet, and that's okay!</strong>
        <p>{children || 'Add someone by their username and plan your next adventure together.'}</p>
      </div>
    </div>
  );
}
