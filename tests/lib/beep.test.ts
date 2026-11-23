import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in for the browser's AudioContext, which starts suspended outside a key press. */
class FakeAudioContext {
  static created = 0;
  static last: FakeAudioContext | null = null;
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  started = 0;
  constructor() {
    FakeAudioContext.created++;
    FakeAudioContext.last = this;
  }
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start: () => this.started++,
      stop: () => {},
    };
  }
  createGain() {
    return { gain: { value: 0 }, connect: (node: unknown) => node };
  }
}

async function loadBeep() {
  vi.resetModules();
  return import("@/lib/beep");
}

describe("beep", () => {
  beforeEach(() => {
    FakeAudioContext.created = 0;
    FakeAudioContext.last = null;
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("unlockAudio creates and resumes the audio during the key press", async () => {
    const { unlockAudio, playErrorBeep } = await loadBeep();
    unlockAudio();
    expect(FakeAudioContext.last?.resume).toHaveBeenCalled();
    unlockAudio();
    playErrorBeep();
    expect(FakeAudioContext.created).toBe(1);
    expect(FakeAudioContext.last?.started).toBe(1);
  });

  it("playErrorBeep resumes a suspended context before playing", async () => {
    const { playErrorBeep } = await loadBeep();
    playErrorBeep();
    expect(FakeAudioContext.last?.resume).toHaveBeenCalled();
    expect(FakeAudioContext.last?.started).toBe(1);
  });

  it("does nothing where audio isn't available", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { unlockAudio, playErrorBeep } = await loadBeep();
    expect(() => unlockAudio()).not.toThrow();
    expect(() => playErrorBeep()).not.toThrow();
  });
});
