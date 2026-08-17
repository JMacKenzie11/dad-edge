/**
 * Public entry for the ITC coach prompt. Only export what callers need —
 * currently just the composer. Stage-specific strings and the preamble
 * are implementation details of this folder.
 */

export { buildItcCoachSystem, buildItcCoachSystemSplit } from "./build";
export type { BuiltCoachSystem } from "./build";
