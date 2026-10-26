import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {
  createFixtureDir,
  generateAudioOnly,
  generateRandomBytes,
  generateVideo,
  type VideoFixtureDir,
} from '../test/video-fixtures';
import { InvalidMediaError } from './media.errors';
import { MediaModule } from './media.module';
import { MediaProbeService } from './media-probe.service';

describe('MediaProbeService (integration)', () => {
  let service: MediaProbeService;
  let fixtures: VideoFixtureDir;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MediaModule],
    }).compile();
    service = moduleRef.get(MediaProbeService);
    fixtures = await createFixtureDir();
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it('should extract duration and metadata from an H.264 MP4', async () => {
    const input = await generateVideo(join(fixtures.path, 'video.mp4'), {
      width: 640,
      height: 360,
      durationSeconds: 3,
    });

    const result = await service.probe(input);

    expect(result.durationSeconds).toBeCloseTo(3, 0);
    expect(result.metadata).toMatchObject({
      width: 640,
      height: 360,
      videoCodec: 'h264',
      audioCodec: 'aac',
      frameRate: 30,
    });
    expect(result.metadata.formatName).toContain('mp4');
    expect(result.metadata.bitRate).toBeGreaterThan(0);
  });

  it('should treat a file name with spaces and ";" as a single argument', async () => {
    const input = await generateVideo(
      join(fixtures.path, 'my video; echo pwned.mp4'),
      { durationSeconds: 1 },
    );

    const result = await service.probe(input);

    expect(result.metadata.videoCodec).toBe('h264');
  });

  it('should throw InvalidMediaError for random bytes', async () => {
    const input = await generateRandomBytes(join(fixtures.path, 'random.mp4'));

    await expect(service.probe(input)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });

  it('should throw InvalidMediaError for an audio-only file', async () => {
    const input = await generateAudioOnly(join(fixtures.path, 'audio.m4a'));

    await expect(service.probe(input)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
  });
});
