import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useFriends } from '../lib/FriendsContext';
import { useTrip } from '../lib/TripContext';
import { INTERESTS } from '../data/regions';
import { allSwipeCards } from '../lib/onboardingCards';
import { saveTasteIntro } from '../lib/friends';
import { friendlyError } from '../lib/friendlyError';
import { usePersistentState } from '../lib/usePersistentState';
import { markNotificationRead } from '../lib/notifications';
import { ONBOARDING_VERSION, isDeckComplete, onboardingStatus, onboardingNoticeId } from '../lib/onboardingVersion';
import {
  answersToPairs,
  cardForWord,
  endOnboardingFlow,
  prefillAnswers,
  saveOnboardingProgress,
  saveOnboardingResults,
} from '../lib/onboardingSave';
import { useWelcomeBonus } from '../lib/useWelcomeBonus';
import { needsFirstCheckIn, useCheckinCount } from '../lib/firstCheckIn';
import { HowToStep, SwipeCardStack } from '../components/OnboardingSteps';
import FirstCheckInStep from '../components/FirstCheckInStep';
import LocationAlwaysStep from '../components/LocationAlwaysStep';
import ErrorNotice from '../components/ErrorNotice';
import { SkeletonList } from '../components/Skeleton';

// The real onboarding flow, run right after sign-up (Profile shows it once
// the email is verified) and, for accounts from before it existed or before
// the current ONBOARDING_VERSION, from the notification and the Map/Mapr
// banner (route /onboarding). The Test tab (OnboardingLab) is the sandbox
// for trying new versions of the same pieces without saving anything.
//
// Steps: verify email (new accounts only, until verified) -> prompt ->
// instructions -> cards -> notes -> first check-in (only while the account has
// no check-in yet) -> "Always" location (new accounts only) -> done. Every
// step but verify and the first check-in has a Skip. The step and the swipes
// are saved to the account as they happen, so closing the app resumes here.
//
// The swipes and notes are saved when the notes step ends; that write is what
// records ONBOARDING_VERSION. The check-in and location steps come after it
// and never affect it.
const CHECKIN_STEP = 'checkin';

function buildSteps({ isNew, verified, needsCheckIn }) {
  return [
    ...(isNew && !verified ? ['verify'] : []),
    'prompt',
    'howto',
    'cards',
    'notes',
    ...(needsCheckIn ? [CHECKIN_STEP] : []),
    ...(isNew ? ['location'] : []),
    'done',
  ];
}

const INTEREST_IDS = new Set(INTERESTS.map((i) => i.id));

export default function Onboarding({ isNew: isNewProp, onExit }) {
  const { user, loading: authLoading, firebaseEnabled } = useAuth();
  const { myProfile, profileFresh } = useFriends();
  const navigate = useNavigate();

  if (authLoading) return <SkeletonList count={3} label="Loading" />;
  if (!firebaseEnabled || !user) return <Navigate to="/profile" replace />;
  if (!profileFresh) return <SkeletonList count={3} label="Loading" />;
  return <Flow key={user.uid} user={user} profile={myProfile} isNewProp={isNewProp} onExit={onExit} navigate={navigate} />;
}

function Flow({ user, profile, isNewProp, onExit, navigate }) {
  const { resendVerification, refreshUser } = useAuth();
  const { trip, toggleSavedInterest } = useTrip();
  const { count: checkinCount, loading: checkinLoading } = useCheckinCount(user.uid);

  const status = onboardingStatus(profile);
  const isNew = isNewProp ?? profile?.onboardingSource === 'signup';
  const progress = profile?.onboardingProgress?.version === ONBOARDING_VERSION ? profile.onboardingProgress : null;

  // Decided once, on entry: opening /onboarding after everything is finished
  // and nothing is half-done has nothing to show. Finishing later in this
  // same visit must not trigger it.
  const [nothingToDo] = useState(() => status === 'complete' && !progress && isNewProp === undefined);

  const [cardWords] = useState(() => {
    const saved = (progress?.cardWords || []).filter((w) => cardForWord(w));
    return saved.length ? saved : allSwipeCards().map((c) => c.word);
  });
  const [answers, setAnswers] = useState(() =>
    prefillAnswers({ cardWords, progress, profile, savedInterests: trip.savedInterests })
  );
  const [stepId, setStepId] = useState(progress?.step || 'prompt');
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resultsSaved, setResultsSaved] = useState(false);

  const verified = !!user.emailVerified;
  const needsCheckIn = needsFirstCheckIn(checkinCount);
  const steps = buildSteps({ isNew, verified, needsCheckIn });
  // A saved or in-flight step that no longer applies (email just verified,
  // check-in count says they already have one) falls forward to the next one
  // that does.
  const ORDER = ['verify', 'prompt', 'howto', 'cards', 'notes', CHECKIN_STEP, 'location', 'done'];
  // The email step is a gate: nothing else shows until the address is verified.
  const current =
    steps[0] === 'verify'
      ? 'verify'
      : steps.includes(stepId)
      ? stepId
      : steps.find((s) => ORDER.indexOf(s) > ORDER.indexOf(stepId)) || 'done';

  const cards = cardWords.map(cardForWord);
  const persist = (patch) => {
    saveOnboardingProgress(user.uid, { step: current, cardWords, answers: answersToPairs(answers), ...patch }).catch(() => {});
  };
  const goTo = (id, patch) => {
    setStepId(id);
    persist({ step: id, ...patch });
  };
  const next = (patch) => {
    const after = steps[steps.indexOf(current) + 1] || 'done';
    goTo(after, patch);
  };

  const { saveError: bonusError, retry: retryBonus } = useWelcomeBonus(resultsSaved);

  const deckDone = isDeckComplete(answers.length, cardWords.length);

  // Saves what was swiped, then moves on. The version (which clears the
  // notification and banner) is recorded only when every card has an answer,
  // so skipping the cards leaves both up until they're done.
  const finishCore = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveOnboardingResults(user.uid, profile, answers, { complete: deckDone });
      // Loved categories also become saved preferences, so Trip Setup's
      // "Use My Preferences" starts from them. Adds only; never removes.
      // A Set, because several cards can share a category and each toggle
      // flips it: two "food" cards would switch it on and straight back off.
      const loved = new Set(answers.filter((a) => a.answer === 'love' && INTEREST_IDS.has(a.card.tag)).map((a) => a.card.tag));
      for (const tag of loved) if (!trip.savedInterests.includes(tag)) toggleSavedInterest(tag);
      if (deckDone) {
        setResultsSaved(true);
        markNotificationRead(onboardingNoticeId()).catch(() => {});
      }
      next();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  // Reaching the end drops the saved progress; from here nothing resumes.
  const clearedRef = useRef(false);
  useEffect(() => {
    if (current !== 'done' || clearedRef.current) return;
    clearedRef.current = true;
    endOnboardingFlow(user.uid, { complete: deckDone, isNew }).catch(() => {});
  }, [current, user.uid, deckDone, isNew]);

  const exit = (to) => {
    onExit?.();
    navigate(to);
  };

  if (nothingToDo) return <Navigate to="/profile" replace />;

  if (current === 'verify') {
    return <VerifyEmail email={user.email} resend={resendVerification} refresh={refreshUser} />;
  }
  if (current === 'prompt') {
    return (
      <div className="lab-center">
        <h1 className="screen-title">
          <span>{'\u{1F389}'}</span> {isNew ? "You're in!" : 'Onboarding has been updated'}
        </h1>
        <p className="screen-subtitle">
          Rate a few things you're into. It takes 60-90 seconds
          {answers.length ? ", and we've filled in what you've already told us" : ''}.
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => next()}>
          Next {'\u{2192}'}
        </button>
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => goTo('notes')}>
          Skip
        </button>
      </div>
    );
  }
  if (current === 'howto') {
    return (
      <div>
        <HowToStep onNext={() => next()} />
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => goTo('notes')}>
          Skip this step
        </button>
      </div>
    );
  }
  if (current === 'cards') {
    return (
      <SwipeCardStack
        cards={cards}
        answers={answers}
        onAnswer={(card, answer) => {
          const list = [...answers.filter((a) => a.card.word !== card.word), { card, answer }];
          setAnswers(list);
          persist({ step: 'cards', answers: answersToPairs(list) });
        }}
        onUndo={() => {
          const list = answers.slice(0, -1);
          setAnswers(list);
          persist({ step: 'cards', answers: answersToPairs(list) });
        }}
        onFinished={() => next()}
        onSkip={() => next()}
      />
    );
  }
  if (current === 'notes') {
    return (
      <NotesStep
        uid={user.uid}
        savedIntro={profile?.tasteIntro || ''}
        saving={saving}
        waiting={checkinLoading}
        error={saveError}
        onDone={finishCore}
      />
    );
  }
  if (current === CHECKIN_STEP) return <FirstCheckInStep required onDone={() => next()} />;
  if (current === 'location') return <LocationAlwaysStep onDone={() => next()} />;

  return (
    <div className="lab-center">
      <h1 className="screen-title">
        <span>{'\u{1F3C1}'}</span> {deckDone ? "You're all set" : "You're set for now"}
      </h1>
      <p className="screen-subtitle">
        {deckDone
          ? 'Mapr has what you told it and will use it for your very next picks. You can change any of it later in Settings.'
          : `${
              answers.length
                ? `Mapr will use the ${answers.length} ${answers.length === 1 ? 'card' : 'cards'} you answered.`
                : "You skipped the cards, so Mapr doesn't know your taste yet."
            } Finish the rest of the cards any time: the banner on the Map tab brings you back.`}
      </p>
      {bonusError && <ErrorNotice compact message={bonusError} onRetry={retryBonus} />}
      <button type="button" className="btn btn-primary btn-block" onClick={() => exit('/mapr')}>
        See my Mapr picks {'\u{2192}'}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => exit('/')}>
        Explore the map
      </button>
    </div>
  );
}

// New accounts wait here until the emailed link is tapped. The screen checks
// again on its own (every few seconds, and whenever the app comes back to
// the front, which is what happens after switching over to Mail and back),
// and a button forces a check.
function VerifyEmail({ email, resend, refresh }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = () => refresh().catch(() => {});
    const timer = setInterval(check, 4000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const run = async (fn, done) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(done);
    } catch (err) {
      setMessage(friendlyError(err, "That didn't work. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lab-center">
      <h1 className="screen-title">
        <span>{'\u{1F4E7}'}</span> Verify your email
      </h1>
      <p className="screen-subtitle">
        We sent a link to <strong>{email}</strong>. Tap it, then come back here. Check your spam folder if you don't
        see it.
      </p>
      {message && (
        <p className="tag tag-free" role="status" style={{ display: 'block', marginBottom: 14 }}>
          {message}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() => run(refresh, "Not verified yet. Tap the link in the email, then try again.")}
      >
        I've verified it
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 10 }}
        disabled={busy}
        onClick={() => run(resend, 'Sent. Check your inbox.')}
      >
        Resend the email
      </button>
    </div>
  );
}

// The old "Tell Mapr what you love" step and the test tab's "Anything else?"
// are the same free-text field (users/{uid}.tasteIntro), so this is one
// screen for both. It shares Settings' draft key, and starts from what the
// account already has saved.
// `waiting` holds the buttons while the check-in count loads, so the step
// after this one is decided from real data.
function NotesStep({ uid, savedIntro, saving, waiting, error, onDone }) {
  const [text, setText, clearDraft] = usePersistentState(`tasteIntro.${uid}`, '');
  const [textError, setTextError] = useState(null);

  useEffect(() => {
    if (!text && savedIntro) setText(savedIntro);
    // Only when the saved copy arrives; typing must never be overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedIntro]);

  const trimmed = text.trim();
  const submittingRef = useRef(false);
  const submit = async (save) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await submitInner(save);
    } finally {
      submittingRef.current = false;
    }
  };
  const submitInner = async (save) => {
    setTextError(null);
    if (save && trimmed && trimmed !== savedIntro.trim()) {
      try {
        await saveTasteIntro(uid, text);
        clearDraft();
      } catch (err) {
        setTextError(err);
        return;
      }
    }
    onDone();
  };

  const shownError = textError || error;
  return (
    <div>
      <h1 className="screen-title">
        <span>{'\u{1F9E9}'}</span> Anything else?
      </h1>
      <p className="screen-subtitle">
        Tell Mapr what you already love in your own words: places, moods, brands. It reads this as written. For
        example: "I love racing, steak, and pickleball. On a Saturday night I want a club, not a trail."
      </p>
      <textarea
        className="rating-comment"
        name="taste-intro"
        autoComplete="off"
        autoCapitalize="sentences"
        aria-label="Anything else you love or hate"
        rows={5}
        maxLength={2000}
        placeholder="Optional"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={saving}
      />
      {shownError && (
        <ErrorNotice
          compact
          message={friendlyError(shownError, "Couldn't save that. Your text is still here. Try again, or skip for now.")}
          onRetry={() => submit(true)}
        />
      )}
      <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={saving || waiting} onClick={() => submit(true)}>
        {saving ? 'Saving…' : `${trimmed ? 'Save & continue' : 'Continue'} \u{2192}`}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} disabled={saving || waiting} onClick={() => submit(false)}>
        Skip for now
      </button>
    </div>
  );
}
