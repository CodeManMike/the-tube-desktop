// Shared session: the main window and PiP must both be signed in.
// TTD_PARTITION=persist:<name> runs against a fresh profile (spike sign-in test).
export const PARTITION = process.env.TTD_PARTITION ?? 'persist:tube';
