import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {
  createFixtureDir,
  generateVideo,
  type VideoFixtureDir,
} from '../test/video-fixtures';
import { MediaModule } from './media.module';
import { MediaProbeService } from './media-probe.service';
import { ThumbnailService } from './thumbnail.service';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe('ThumbnailService (integration)', () => {
  let thumbnails: ThumbnailService;
  let probe: MediaProbeService;
  let fixtures: VideoFixtureDir;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MediaModule],
    }).compile();
    thumbnails = moduleRef.get(ThumbnailService);
    probe = moduleRef.get(MediaProbeService);
    fixtures = await createFixtureDir();
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it('should generate a JPEG capped at 1280px wide with the aspect ratio preserved', async () => {
    const input = await generateVideo(join(fixtures.path, 'full-hd.mp4'), {
      width: 1920,
      height: 1080,
      durationSeconds: 2,
    });
    const output = join(fixtures.path, 'thumb.jpg');

    await thumbnails.extractFrame(input, thumbnails.computeOffset(2), output);

    const bytes = await readFile(output);
    expect(bytes.subarray(0, 3).equals(JPEG_MAGIC)).toBe(true);
    const { metadata } = await probe.probe(output);
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
  });

  it('should keep the original size when narrower than 1280px', async () => {
    const input = await generateVideo(join(fixtures.path, 'small video;.mp4'), {
      width: 640,
      height: 360,
      durationSeconds: 1,
    });
    const output = join(fixtures.path, 'small thumb;.jpg');

    await thumbnails.extractFrame(input, 0, output);

    const { metadata } = await probe.probe(output);
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(360);
  });
});
