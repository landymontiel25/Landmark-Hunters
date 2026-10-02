import { useLocation, useNavigate } from 'react-router-dom';
import { goBack } from '../lib/goBack';

const EFFECTIVE_DATE = 'September 12, 2026';
const CONTACT_EMAIL = 'supportlandmarkhunters@gmail.com';

// Reachable with no sign-in required -- App Store Connect needs a public
// URL for this before a build can even be submitted for review, and a
// reviewer or a real visitor should never have to log in to read it.
export default function Legal() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => goBack(navigate, location)} style={{ marginBottom: 16 }}>
        {'← Back'}
      </button>

      <h1 className="screen-title">Privacy Policy & Terms of Service</h1>
      <p className="screen-subtitle">Landmark Hunters — effective {EFFECTIVE_DATE}</p>

      <div className="card section">
        <h2 style={{ marginTop: 0 }}>Privacy Policy</h2>

        <h3>What we collect</h3>
        <p>
          <strong>Account info:</strong> the email address and display name you sign up with.
          <br />
          <strong>Location:</strong> your device's GPS location, used to center the map, calculate an itinerary, and
          verify you're physically within range of a landmark when you check in. Location is only read while you're
          using the app.
          <br />
          <strong>Photos:</strong> any photo you choose to attach to a check-in, a review, or a landmark you submit.
          <br />
          <strong>Content you create:</strong> reviews, star ratings, comments, landmark submissions, and your list of
          friends.
          <br />
          <strong>Usage data:</strong> basic app activity (check-ins, points, which screens you use) needed to run
          the leaderboard and your stats.
        </p>

        <h3>How we use it</h3>
        <p>
          To run the core features: planning a trip, verifying check-ins, showing the leaderboard, letting friends
          find and follow each other, and (if you use it) answering questions through the in-app AI assistant. We
          don't sell your data, and we don't use it for advertising.
        </p>

        <h3>Who we share it with</h3>
        <p>
          We use a small number of service providers to run the app, each only for that purpose:
          <br />
          <strong>Firebase (Google):</strong> sign-in, database, and photo storage.
          <br />
          <strong>Anthropic:</strong> powers the in-app AI assistant and trip-planning features — questions you ask
          it are sent to Anthropic's API to generate a response.
          <br />
          <strong>Vercel:</strong> hosts the app and its backend functions.
          <br />
          If you book a landmark's tickets through the app, that booking is completed with our booking partner
          (GetYourGuide, Viator, or Tiqets), subject to their own privacy policy.
        </p>

        <h3>Place data and photos</h3>
        <p>
          Many places come from{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap contributors
          </a>{' '}
          (Open Database License), with some facts from Wikidata (CC0). Photos credited to an author and license come
          from Wikimedia Commons; photos marked "via Google Maps" load from Google each time and are never stored.
        </p>

        <h3>Your choices</h3>
        <p>
          You can make your profile private (Profile → Privacy), block or report another user's content (on any
          review), or delete your account entirely (Settings → Delete Account) — which removes your profile, reviews,
          photos, friend connections, streaks, saved Mapr chats and trips, and the landmarks you submitted. Check-ins stay on the leaderboard for scoring integrity but are stripped of your
          name and photo once your account is deleted.
        </p>

        <h3>Children's privacy</h3>
        <p>Landmark Hunters isn't directed at children under 13, and we don't knowingly collect data from them.</p>

        <h3>Changes</h3>
        <p>
          If this policy changes in a meaningful way, we'll update the effective date above. Continuing to use the
          app after a change means you accept the update.
        </p>

        <h3>Contact</h3>
        <p>
          Questions about this policy or your data:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--color-brass)' }}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>

      <div className="card section">
        <h2 style={{ marginTop: 0 }}>Terms of Service</h2>

        <h3>Using Landmark Hunters</h3>
        <p>
          By creating an account or using the app, you agree to these terms. You're responsible for what you post —
          reviews, photos, landmark submissions — and for keeping your login secure.
        </p>

        <h3>Acceptable use</h3>
        <p>
          Don't post content that's abusive, illegal, or that you don't have the right to share. We may remove
          content or suspend an account that violates this, and you can report or block another user's content
          directly in the app.
        </p>

        <h3>Location & check-ins</h3>
        <p>
          Check-in verification relies on your device's GPS, which isn't always exact. Points and leaderboard
          standing are for fun and bragging rights — they don't represent a certified record of where you've been.
        </p>

        <h3>Bookings</h3>
        <p>
          "Book Now" links hand off to a third-party booking partner. Landmark Hunters isn't the merchant of record
          for those bookings and isn't responsible for the partner's pricing, availability, or service.
        </p>

        <h3>No warranty</h3>
        <p>
          The app is provided "as is." We don't guarantee it will be error-free, uninterrupted, or perfectly
          accurate (landmark facts, hours, and distances included), and we're not liable for decisions made based on
          it.
        </p>

        <h3>Changes to the service</h3>
        <p>We may add, change, or remove features at any time, including this page's terms themselves.</p>

        <h3>Contact</h3>
        <p>
          Questions about these terms:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--color-brass)' }}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
