import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 32000;
const duration = 32;
const channels = 2;
const sampleCount = sampleRate * duration;
const bytesPerSample = 2;
const dataSize = sampleCount * channels * bytesPerSample;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
wav.writeUInt16LE(channels * bytesPerSample, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataSize, 40);

const circle = Math.PI * 2;
for (let index = 0; index < sampleCount; index += 1) {
  const time = index / sampleRate;
  const orbit = circle * time / duration;
  const drift = Math.sin(orbit);
  const shimmer = Math.sin(orbit * 2 + 0.7);
  const drone = 0.25 * Math.sin(circle * 110 * time + drift * 0.6)
    + 0.18 * Math.sin(circle * 164.8125 * time - shimmer * 0.45)
    + 0.13 * Math.sin(circle * 220.03125 * time + drift * 0.3);
  const cosmic = 0.075 * Math.sin(circle * 329.625 * time + drift * 1.4)
    + 0.045 * Math.sin(circle * 493.875 * time + shimmer * 1.2);
  const pulse = 0.78 + 0.16 * Math.sin(orbit + 0.4);
  const left = drone * pulse + cosmic * (0.55 + 0.3 * Math.sin(orbit + 0.8));
  const right = drone * (0.78 + 0.16 * Math.sin(orbit - 0.4))
    + cosmic * (0.55 + 0.3 * Math.sin(orbit - 0.8));
  const offset = 44 + index * channels * bytesPerSample;
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32767), offset);
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32767), offset + bytesPerSample);
}

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/assets/audio/space-ambient.wav');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, wav);
console.log(`Created ${output} (${duration}s, ${sampleRate} Hz, stereo PCM)`);