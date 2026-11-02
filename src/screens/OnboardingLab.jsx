import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { isAdmin } from '../lib/admins';
import { progressTier } from '../components/OnboardingSteps';
import { NOTHING_TO_TEST } from './onboardingLabConfig';
import MallLab from './MallLab';
import TasteProfileLab from './TasteProfileLab';
import RatingSliderLab from './RatingSliderLab';
import ItineraryTutorialLab from './ItineraryTutorialLab';
import UltimateTutorialLab from './UltimateTutorialLab';
import GameTutorialLab from './GameTutorialLab';
import UILab from './UILab';
import PlannerLab from './PlannerLab';

export { progressTier };

// Admin-only sandbox (the Test tab). The onboarding tutorials are Planner
// tutorial (UltimateTutorialLab.jsx) and Game tutorial (GameTutorialLab.jsx),
// built from the step pieces in SignupTutorialLab.jsx, FirstRunLab.jsx and
// ExplainerImagesLab.jsx. The old Tutorial and Tutorial 2 bubbles were
// removed (owner, 2026-11-02). Nothing in any test is saved.
// The Test tab's sub-tabs, shown as floating bubbles above the test. Add an
// entry here (and render it below) for each new test.
const TESTS = [
  { id: 'ui', label: 'UI' },
  { id: 'slider', label: 'Rating slider' },
  { id: 'malls', label: 'Malls' },
  { id: 'ultimate', label: 'Planner tutorial' },
  { id: 'game', label: 'Game tutorial' },
  { id: 'itinerary', label: 'Itinerary tutorial' },
  { id: 'taste', label: 'Taste Profile' },
  { id: 'planner', label: 'Planner launch' },
];

export default function OnboardingLab() {
  const { user, loading: authLoading } = useAuth();
  const [test, setTest] = useState('ui');

  if (authLoading) return null;
  if (!isAdmin(user?.email)) return <Navigate to="/" replace />;

  const testTabs = (
    <div className="lab-tabs" role="tablist" aria-label="Tests">
      {TESTS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={test === t.id}
          className={`lab-tab ${test === t.id ? 'active' : ''}`}
          onClick={() => setTest(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (test === 'ui') {
    return (
      <div>
        {testTabs}
        <UILab />
      </div>
    );
  }

  if (test === 'slider') {
    return (
      <div>
        {testTabs}
        <RatingSliderLab />
      </div>
    );
  }

  if (test === 'malls') {
    return (
      <div>
        {testTabs}
        <MallLab uid={user?.uid} />
      </div>
    );
  }

  // The switch in onboardingLabConfig.js hides the onboarding tutorials.
  if (NOTHING_TO_TEST && (test === 'ultimate' || test === 'game')) {
    return (
      <div className="lab-center">
        {testTabs}
        <h1 className="screen-title">
          <span>{'\u{1F9EA}'}</span> Nothing to test
        </h1>
        <p className="screen-subtitle">There's no new onboarding to try right now. This tab will come back when there is.</p>
      </div>
    );
  }

  if (test === 'planner') {
    return (
      <div>
        {testTabs}
        <PlannerLab />
      </div>
    );
  }

  if (test === 'game') {
    return (
      <div>
        {testTabs}
        <GameTutorialLab />
      </div>
    );
  }

  if (test === 'game') {
    return (
      <div>
        {testTabs}
        <GameTutorialLab />
      </div>
    );
  }

  if (test === 'ultimate') {
    return (
      <div>
        {testTabs}
        <UltimateTutorialLab />
      </div>
    );
  }

  if (test === 'itinerary') {
    return (
      <div>
        {testTabs}
        <ItineraryTutorialLab />
      </div>
    );
  }

  if (test === 'taste') {
    return (
      <div>
        {testTabs}
        <TasteProfileLab />
      </div>
    );
  }

  return testTabs;
}
