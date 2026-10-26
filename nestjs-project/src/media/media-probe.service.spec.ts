import { Test } from '@nestjs/testing';
import { PROCESS_RUNNER } from './media.constants';
import { InvalidMediaError, ProcessExecutionError } from './media.errors';
import { MediaProbeService } from './media-probe.service';
import type { ProcessRunner } from './process-runner';

const ffprobeOutput = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '30000/1001',
        r_frame_rate: '30/1',
      },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '12.345000',
      bit_rate: '2500000',
    },
    ...overrides,
  });

describe('MediaProbeService', () => {
  let service: MediaProbeService;
  let runner: jest.MockedFunction<ProcessRunner>;

  beforeEach(async () => {
    runner = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaProbeService,
        { provide: PROCESS_RUNNER, useValue: runner },
      ],
    }).compile();
    service = moduleRef.get(MediaProbeService);
  });

  it('should map the ffprobe JSON to the curated metadata', async () => {
    runner.mockResolvedValue({ stdout: ffprobeOutput(), stderr: '' });

    const result = await service.probe('/videos/source.mp4');

    expect(result).toEqual({
      durationSeconds: 12.345,
      metadata: {
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        bitRate: 2500000,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        videoCodec: 'h264',
        audioCodec: 'aac',
      },
    });
  });

  it('should pass the input as a single argument to ffprobe', async () => {
    runner.mockResolvedValue({ stdout: ffprobeOutput(), stderr: '' });
    const input = '/tmp/my video; rm -rf ~.mp4';

    await service.probe(input);

    const [command, args] = runner.mock.calls[0];
    expect(command).toBe('ffprobe');
    expect(args.at(-1)).toBe(input);
    expect(args.filter((arg) => arg.includes('my video'))).toHaveLength(1);
  });

  it('should return nulls for absent optional fields', async () => {
    runner.mockResolvedValue({
      stdout: JSON.stringify({
        streams: [
          { codec_type: 'video', avg_frame_rate: '0/0', r_frame_rate: '0/0' },
        ],
        format: {},
      }),
      stderr: '',
    });

    const result = await service.probe('in.mp4');

    expect(result).toEqual({
      durationSeconds: null,
      metadata: {
        formatName: 'unknown',
        bitRate: null,
        width: null,
        height: null,
        frameRate: null,
        videoCodec: null,
        audioCodec: null,
      },
    });
  });

  it('should fall back to r_frame_rate when avg_frame_rate is unknown', async () => {
    runner.mockResolvedValue({
      stdout: JSON.stringify({
        streams: [
          { codec_type: 'video', avg_frame_rate: '0/0', r_frame_rate: '25/1' },
        ],
        format: {},
      }),
      stderr: '',
    });

    const result = await service.probe('in.mp4');

    expect(result.metadata.frameRate).toBe(25);
  });

  it('should throw InvalidMediaError when there is no video stream', async () => {
    runner.mockResolvedValue({
      stdout: ffprobeOutput({ streams: [{ codec_type: 'audio' }] }),
      stderr: '',
    });

    await expect(service.probe('audio.m4a')).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should throw InvalidMediaError when the output is not parseable', async () => {
    runner.mockResolvedValue({ stdout: 'not json', stderr: '' });

    await expect(service.probe('in.mp4')).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should throw InvalidMediaError when ffprobe rejects the data as invalid', async () => {
    runner.mockRejectedValue(
      new ProcessExecutionError(
        'ffprobe',
        1,
        'in.bin: Invalid data found when processing input',
        false,
      ),
    );

    await expect(service.probe('in.bin')).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should propagate other process failures as retryable errors', async () => {
    const error = new ProcessExecutionError(
      'ffprobe',
      1,
      'Server returned 403 Forbidden (access denied)',
      false,
    );
    runner.mockRejectedValue(error);

    await expect(service.probe('http://minio:9000/x')).rejects.toBe(error);
  });

  it('should propagate timeouts as retryable errors', async () => {
    const error = new ProcessExecutionError('ffprobe', null, '', true);
    runner.mockRejectedValue(error);

    await expect(service.probe('in.mp4')).rejects.toBe(error);
  });
});
