import { createContext, useContext } from 'react';
import * as TUTORIAL_1 from './signupTutorialSteps';

// Which tutorial's words and steps the Tutorial pieces read (Test tab): the
// Tutorial sub-tab uses signupTutorialSteps.js, Tutorial 2 its own copy in
// signupTutorial2Steps.js, so each can change without touching the other.
export const TutorialText = createContext(TUTORIAL_1);
export const useTutorialText = () => useContext(TutorialText);
