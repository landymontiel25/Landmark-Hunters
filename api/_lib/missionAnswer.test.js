import { describe, expect, it, vi } from 'vitest';

vi.mock('./firebaseAdmin.js', () => ({ adminDb: () => null }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n) => n, serverTimestamp: () => 0 } }));

const { missionAnswerDecision, MISSION_POINTS } = await import('./missionAnswer.js');
const { getLandmark } = await import('../../src/data/regions.js');
const { TRIVIA_ANSWERS } = await import('./triviaAnswers.js');

const mission = getLandmark('abacos', 'albury-brothers-boatbuilding').mission;
const right = TRIVIA_ANSWERS['albury-brothers-boatbuilding'];
const visited = [{ landmarkId: 'albury-brothers-boatbuilding', visited: true, presence: { verified: true } }];

describe('missionAnswerDecision', () => {
  it('pays +10 for the right answer', () => {
    expect(MISSION_POINTS).toBe(10);
    expect(missionAnswerDecision({ right, mission, answer: right, checkins: visited, previous: null })).toMatchObject({ awarded: 10, correct: true });
  });

  it('pays nothing for a wrong answer, and only then says which was right', () => {
    const wrong = (right + 1) % 4;
    const first = missionAnswerDecision({ right, mission, answer: wrong, checkins: visited, previous: null });
    expect(first).toMatchObject({ awarded: 0, correct: false, picked: wrong, answer: right });
    // A second ask can't change the answer: still wrong, still 0, same right answer.
    expect(missionAnswerDecision({ right, mission, answer: right, checkins: visited, previous: { correct: false, answer: wrong } })).toMatchObject({ awarded: 0, reason: 'already', correct: false, picked: wrong, answer: right });
    expect(missionAnswerDecision({ right, mission, answer: right, checkins: visited, previous: { correct: true, answer: right } }).answer).toBe(right);
  });

  it('never gives the right answer before the account has answered', () => {
    // Without a verified check-in, or with an answer that isn't one of the four,
    // nothing is recorded and the right answer stays on the server.
    expect(missionAnswerDecision({ right, mission, answer: 0, checkins: [], previous: null })).not.toHaveProperty('answer');
    expect(missionAnswerDecision({ right, mission, answer: 9, checkins: visited, previous: null })).not.toHaveProperty('answer');
    expect(missionAnswerDecision({ right, mission, answer: -1, checkins: visited, previous: null })).not.toHaveProperty('answer');
  });

  it('the app\'s own data carries no answers (anti-farming item 6)', () => {
    for (const id of Object.keys(TRIVIA_ANSWERS)) expect(getLandmark('abacos', id).mission.answer).toBeUndefined();
  });

  it('needs a real check-in there', () => {
    expect(missionAnswerDecision({ right, mission, answer: right, checkins: [], previous: null }).reason).toBe('no-checkin');
    expect(missionAnswerDecision({ right, mission, answer: right, checkins: [{ ratingOnly: true }], previous: null }).reason).toBe('no-checkin');
  });

  it('counts one answer per place', () => {
    expect(missionAnswerDecision({ right, mission, answer: right, checkins: visited, previous: { correct: false, answer: 1 } })).toMatchObject({ awarded: 0, reason: 'already', correct: false });
  });

  it('refuses an answer that is not one of the four', () => {
    expect(missionAnswerDecision({ right, mission, answer: 7, checkins: visited, previous: null }).reason).toBe('bad-answer');
  });

  it('has no trivia for a photo mission', () => {
    expect(missionAnswerDecision({ mission: getLandmark('abacos', 'tahiti-beach').mission, answer: 0, checkins: visited, previous: null }).reason).toBe('no-trivia');
  });
});

describe('trivia needs a verified visit', () => {
  it('pays nothing on an unverified check-in', () => {
    const mission = { type: 'trivia', options: ['a', 'b', 'c', 'd'], answer: 1 };
    expect(missionAnswerDecision({ right, mission, answer: 1, checkins: [{ visited: true }], previous: null }).reason).toBe('no-checkin');
  });
});
