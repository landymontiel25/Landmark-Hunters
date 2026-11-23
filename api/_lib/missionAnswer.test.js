import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebaseAdmin.js', () => ({ adminDb: () => null }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n) => n, serverTimestamp: () => 0 } }));

const { missionAnswerDecision, MISSION_POINTS } = await import('./missionAnswer.js');
const { getLandmark } = await import('../../src/data/regions.js');

const mission = getLandmark('abacos', 'albury-brothers-boatbuilding').mission;
const visited = [{ landmarkId: 'albury-brothers-boatbuilding', visited: true, presence: { verified: true } }];

describe('missionAnswerDecision', () => {
  it('pays +10 for the right answer', () => {
    expect(MISSION_POINTS).toBe(10);
    expect(missionAnswerDecision({ mission, answer: mission.answer, checkins: visited, previous: null })).toMatchObject({ awarded: 10, correct: true });
  });

  it('pays nothing for a wrong answer, and says which was right', () => {
    const wrong = (mission.answer + 1) % 4;
    expect(missionAnswerDecision({ mission, answer: wrong, checkins: visited, previous: null })).toMatchObject({ awarded: 0, correct: false, answer: mission.answer });
  });

  it('needs a real check-in there', () => {
    expect(missionAnswerDecision({ mission, answer: mission.answer, checkins: [], previous: null }).reason).toBe('no-checkin');
    expect(missionAnswerDecision({ mission, answer: mission.answer, checkins: [{ ratingOnly: true }], previous: null }).reason).toBe('no-checkin');
  });

  it('counts one answer per place', () => {
    expect(missionAnswerDecision({ mission, answer: mission.answer, checkins: visited, previous: { correct: false, answer: 1 } })).toMatchObject({ awarded: 0, reason: 'already', correct: false });
  });

  it('refuses an answer that is not one of the four', () => {
    expect(missionAnswerDecision({ mission, answer: 7, checkins: visited, previous: null }).reason).toBe('bad-answer');
  });

  it('has no trivia for a photo mission', () => {
    expect(missionAnswerDecision({ mission: getLandmark('abacos', 'tahiti-beach').mission, answer: 0, checkins: visited, previous: null }).reason).toBe('no-trivia');
  });
});

describe('trivia needs a verified visit', () => {
  it('pays nothing on an unverified check-in', () => {
    const mission = { type: 'trivia', options: ['a', 'b', 'c', 'd'], answer: 1 };
    expect(missionAnswerDecision({ mission, answer: 1, checkins: [{ visited: true }], previous: null }).reason).toBe('no-checkin');
  });
});
