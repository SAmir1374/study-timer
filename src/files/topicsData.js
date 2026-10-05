/* =============================================================
   topicsData.js

   Static reference data: for each subject, the list of topics offered
   in the searchable topic picker (shown after a study/practice/review
   session finishes). Pure lookup — never mutated, never saved into
   study-data.json (only the topic name CHOSEN for a session is saved,
   on that session's own `topic` field — see dataLayer.js).
   ============================================================= */
import TOPICS_DATA from "../topics.json" with { type: "json" };

const bySubject = new Map((TOPICS_DATA.subjects || []).map((s) => [s.name, s.topics || []]));

/** Topics offered for a given subject name, or [] if the subject is unknown/null. */
export function getTopicsForSubject(subjectName) {
  if (!subjectName) return [];
  return bySubject.get(subjectName) || [];
}

/** All topics across all subjects (flat, deduplicated) — used when a session has no subject. */
export function getAllTopics() {
  const set = new Set();
  for (const topics of bySubject.values()) {
    for (const t of topics) set.add(t);
  }
  return [...set];
}
