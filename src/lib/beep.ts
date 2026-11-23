let audio: AudioContext | null = null;

/**
 * The page's audio, created or resumed now. Browsers keep audio paused until a key press or
 * click, and a failed scan beeps only after its lookup returns, outside the key press; calling
 * this from the Enter key handler lets that later beep sound.
 */
function context(): AudioContext {
  audio ??= new AudioContext();
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  return audio;
}

/** Call from a key or click handler so a beep that plays later is allowed to sound. */
export function unlockAudio(): void {
  try {
    context();
  } catch {
    // No audio here: nothing to unlock.
  }
}

/** A short low tone for a failed scan. Does nothing where audio isn't available. */
export function playErrorBeep(): void {
  try {
    const ctx = context();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // No audio (blocked, unsupported or a test browser): the red message is enough.
  }
}
