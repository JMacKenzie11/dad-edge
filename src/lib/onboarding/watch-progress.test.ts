import { describe, expect, it } from "vitest";
import { advance, isUnlocked, parseSaved, resumeAt, START, type WatchState } from "./watch-progress";

function play(from: WatchState, to: number, step = 0.25): WatchState {
  let s = from;
  for (let t = s.at + step; t <= to + 1e-9; t += step) s = advance(s, t);
  return s;
}

describe("onboarding video watch progress", () => {
  it("counts normal playback, including 2x speed", () => {
    expect(play(START, 100).reached).toBeCloseTo(100);
    expect(play(START, 100, 0.5).reached).toBeCloseTo(100);
  });

  it("doesn't count dragging the slider to the end", () => {
    const s = advance(play(START, 30), 450);
    expect(s.reached).toBeCloseTo(30);
    // ...nor playing on from where he dragged to
    expect(play(s, 456).reached).toBeCloseTo(30);
    expect(isUnlocked(play(s, 456), 456)).toBe(false);
  });

  it("keeps what he watched when he rewinds, and plays on from the frontier", () => {
    let s = play(START, 200);
    s = advance(s, 50);
    expect(s.reached).toBeCloseTo(200);
    s = play(s, 260);
    expect(s.reached).toBeCloseTo(260);
  });

  it("unlocks at 90% of the length", () => {
    expect(isUnlocked(play(START, 400), 456)).toBe(false);
    expect(isUnlocked(play(START, 411), 456)).toBe(true);
    expect(isUnlocked(play(START, 411), 0)).toBe(false);
  });

  it("resumes at his last spot unless he was at the very start or end", () => {
    expect(resumeAt({ reached: 300, at: 300 }, 456)).toBe(300);
    expect(resumeAt({ reached: 3, at: 3 }, 456)).toBe(0);
    expect(resumeAt({ reached: 450, at: 450 }, 456)).toBe(0);
  });

  it("survives junk in browser storage", () => {
    expect(parseSaved(null)).toEqual(START);
    expect(parseSaved("not json")).toEqual(START);
    expect(parseSaved('{"reached":-1,"at":4}')).toEqual(START);
    expect(parseSaved('{"reached":120,"at":90}')).toEqual({ reached: 120, at: 90 });
  });
});
