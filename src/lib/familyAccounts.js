// Founder and family accounts (Firebase Auth UIDs). The owner stats leave
// them out of retention and the Mapr match rate, and show active users and
// ratings per active user twice: everyone, and outside family only. Find a
// UID in the Firebase console under Authentication > Users (User UID column).
// Owner stats only: the app itself never reads this list.
export const FAMILY_UIDS = [];

// The stats dataset can carry its own list (tests); otherwise this one.
export const familySet = (ds) => new Set(ds?.familyUids ?? FAMILY_UIDS);

export const withoutFamily = (rows, family, key = 'userId') => (rows || []).filter((r) => !family.has(r?.[key]));
