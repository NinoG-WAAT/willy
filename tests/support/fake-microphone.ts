import type { Page } from "@playwright/test";

/**
 * A deterministic fake microphone for browser tests: `getUserMedia` returns a Web Audio tone, so
 * the real MediaRecorder, level meter and upload code all run without any audio hardware (CI has
 * none, and some machines hang waiting for a device). No audio file is needed or committed.
 */
export async function installFakeMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => {
      const context = new AudioContext();
      const tone = context.createOscillator();
      tone.frequency.value = 440;
      const destination = context.createMediaStreamDestination();
      tone.connect(destination);
      tone.start();
      return Promise.resolve(destination.stream);
    };
  });
}
