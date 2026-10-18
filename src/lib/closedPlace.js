// A place closed for good (landmark data: permanentlyClosed: true, with the
// URL that reports it in closedSource). Cards and the landmark page label it
// CLOSED, and Mapr never suggests it (maprRank/surfaces.js rankPlaces).
export const isPermanentlyClosed = (l) => !!l && l.permanentlyClosed === true;
