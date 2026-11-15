let audio: AudioContext | null = null;

/** A short low tone for a failed scan. Does nothing where audio isn't available. */
export function playErrorBeep(): void {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.18);
  } catch {
    // No audio (blocked, unsupported or a test browser): the red message is enough.
  }
}
