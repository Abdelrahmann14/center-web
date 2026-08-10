// Primitive aliases shared across the API contract. They document intent at
// call sites without adding runtime cost.

/** A backend UUID, carried as a string on the wire. */
export type UUID = string;

/** An ISO-8601 timestamp string (e.g. "2026-07-19T12:00:00Z"). */
export type ISODateTime = string;
