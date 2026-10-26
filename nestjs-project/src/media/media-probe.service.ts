import { Inject, Injectable } from '@nestjs/common';
import type { VideoMetadata } from '../videos/videos.types';
import { FFPROBE_TIMEOUT_MS, PROCESS_RUNNER } from './media.constants';
import { InvalidMediaError, ProcessExecutionError } from './media.errors';
import type { ProcessRunner } from './process-runner';

export interface ProbeResult {
  durationSeconds: number | null;
  metadata: VideoMetadata;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
}

// ffprobe's message for undecodable input (AVERROR_INVALIDDATA). Any other
// failure (network, storage, timeout) is transient and must stay retryable.
const INVALID_DATA_PATTERN = /Invalid data found when processing input/i;

@Injectable()
export class MediaProbeService {
  constructor(@Inject(PROCESS_RUNNER) private readonly runner: ProcessRunner) {}

  async probe(input: string): Promise<ProbeResult> {
    const output = this.parse(await this.runFfprobe(input));

    const videoStream = output.streams?.find((s) => s.codec_type === 'video');
    if (!videoStream) {
      throw new InvalidMediaError('No video stream found in input');
    }
    const audioStream = output.streams?.find((s) => s.codec_type === 'audio');

    return {
      durationSeconds: toNumber(output.format?.duration),
      metadata: {
        formatName: output.format?.format_name ?? 'unknown',
        bitRate: toNumber(output.format?.bit_rate),
        width: videoStream.width ?? null,
        height: videoStream.height ?? null,
        frameRate:
          parseFrameRate(videoStream.avg_frame_rate) ??
          parseFrameRate(videoStream.r_frame_rate),
        videoCodec: videoStream.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
      },
    };
  }

  private async runFfprobe(input: string): Promise<string> {
    try {
      const { stdout } = await this.runner(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          input,
        ],
        { timeoutMs: FFPROBE_TIMEOUT_MS },
      );
      return stdout;
    } catch (error) {
      if (
        error instanceof ProcessExecutionError &&
        !error.timedOut &&
        INVALID_DATA_PATTERN.test(error.stderr)
      ) {
        throw new InvalidMediaError(error.stderr.trim());
      }
      throw error;
    }
  }

  private parse(stdout: string): FfprobeOutput {
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new InvalidMediaError('ffprobe output is not a JSON object');
      }
      return parsed as FfprobeOutput;
    } catch (error) {
      if (error instanceof InvalidMediaError) throw error;
      throw new InvalidMediaError('ffprobe output is not parseable');
    }
  }
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ffprobe reports rates as fractions ("30000/1001"); "0/0" means unknown.
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (
    !Number.isFinite(num) ||
    !Number.isFinite(den) ||
    den === 0 ||
    num === 0
  ) {
    return null;
  }
  return Math.round((num / den) * 1000) / 1000;
}
