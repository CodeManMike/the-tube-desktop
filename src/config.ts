// Shared session: the main window and PiP must both be signed in.
// TUBE_PARTITION=persist:<name> runs against a fresh profile (spike sign-in test).
export const PARTITION = process.env.TUBE_PARTITION ?? 'persist:tube';
