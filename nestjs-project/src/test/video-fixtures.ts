import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../media/process-runner';

const FIXTURE_TIMEOUT_MS = 60_000;

export interface VideoFixtureDir {
  path: string;
  cleanup: () => Promise<void>;
}

export async function createFixtureDir(): Promise<VideoFixtureDir> {
  const path = await mkdtemp(join(tmpdir(), 'streamtube-fixtures-'));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

// H.264 MP4 with a test pattern and a sine audio track.
export async function generateVideo(
  outputPath: string,
  { width = 640, height = 360, durationSeconds = 3 } = {},
): Promise<string> {
  await runProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${width}x${height}:rate=30:duration=${durationSeconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outputPath,
    ],
    { timeoutMs: FIXTURE_TIMEOUT_MS },
  );
  return outputPath;
}

export async function generateAudioOnly(
  outputPath: string,
  durationSeconds = 2,
): Promise<string> {
  await runProcess(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
      '-c:a',
      'aac',
      outputPath,
    ],
    { timeoutMs: FIXTURE_TIMEOUT_MS },
  );
  return outputPath;
}

export async function generateRandomBytes(
  outputPath: string,
  sizeBytes = 64 * 1024,
): Promise<string> {
  await writeFile(outputPath, randomBytes(sizeBytes));
  return outputPath;
}
