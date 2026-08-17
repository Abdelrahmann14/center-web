/**
 * Window events the app fires at itself, for the rare case where two screens
 * have to agree on something that happened outside both of them.
 *
 * <p>In their own module rather than beside the code that dispatches them: a
 * lazily-loaded page importing from `App` would pull the router's whole entry
 * module into that page's chunk and close an import cycle for the sake of one
 * string.
 */

/** A Google account has actually been stored - screens showing it should re-read. */
export const GOOGLE_CONNECTED = "google:connected";
