import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import {
  InvalidMediaError,
  ProcessExecutionError,
} from '../../media/media.errors';
import { MediaProbeService } from '../../media/media-probe.service';
import { ThumbnailService } from '../../media/thumbnail.service';
import { StorageService } from '../../storage/storage.service';
import { Video } from '../entities/video.entity';
import type { VideoStatus } from '../videos.types';
import { VideoProcessingService } from './video-processing.service';

const VIDEO_ID = '6f1c1d36-8a0e-4b8f-9d4f-2f4c6c1d2e3a';
const SOURCE_URL = 'http://minio:9000/streamtube-videos/source?signed';

const buildVideo = (status: VideoStatus): Video =>
  ({
    id: VIDEO_ID,
    status,
    source_key: `videos/${VIDEO_ID}/source`,
  }) as Video;

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  const videoRepository = {
    findOneBy: jest.fn<Promise<Video | null>, [Partial<Video>]>(),
    update: jest.fn<Promise<unknown>, [Partial<Video>, Partial<Video>]>(),
  };
  const storageService = {
    presignGetObject: jest.fn<Promise<string>, [string, unknown]>(),
    putObject: jest.fn<Promise<void>, [string, unknown, string]>(),
  };
  const mediaProbeService = {
    probe: jest.fn<ReturnType<MediaProbeService['probe']>, [string]>(),
  };
  const thumbnailService = {
    computeOffset: jest.fn<number, [number | null]>(),
    extractFrame: jest.fn<Promise<void>, [string, number, string]>(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    storageService.presignGetObject.mockResolvedValue(SOURCE_URL);
    thumbnailService.computeOffset.mockReturnValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: StorageService, useValue: storageService },
        { provide: MediaProbeService, useValue: mediaProbeService },
        { provide: ThumbnailService, useValue: thumbnailService },
      ],
    }).compile();
    service = moduleRef.get(VideoProcessingService);
  });

  describe('process', () => {
    it.each<VideoStatus>(['draft', 'ready', 'failed'])(
      'should skip a video in %s without touching storage or the row',
      async (status) => {
        videoRepository.findOneBy.mockResolvedValue(buildVideo(status));

        await service.process(VIDEO_ID);

        expect(storageService.presignGetObject).not.toHaveBeenCalled();
        expect(mediaProbeService.probe).not.toHaveBeenCalled();
        expect(videoRepository.update).not.toHaveBeenCalled();
      },
    );

    it('should skip a video that no longer exists', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await service.process(VIDEO_ID);

      expect(mediaProbeService.probe).not.toHaveBeenCalled();
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should probe through an internal presigned URL', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo('processing'));
      mediaProbeService.probe.mockRejectedValue(
        new ProcessExecutionError('ffprobe', 1, 'boom', false),
      );

      await expect(service.process(VIDEO_ID)).rejects.toThrow();

      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        `videos/${VIDEO_ID}/source`,
        expect.objectContaining({ endpoint: 'internal' }),
      );
      expect(mediaProbeService.probe).toHaveBeenCalledWith(SOURCE_URL);
    });

    it('should turn InvalidMediaError into an UnrecoverableError(INVALID_MEDIA)', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo('processing'));
      mediaProbeService.probe.mockRejectedValue(
        new InvalidMediaError('Invalid data found when processing input'),
      );

      const error = await service.process(VIDEO_ID).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnrecoverableError);
      expect((error as Error).message).toBe('INVALID_MEDIA');
      expect(thumbnailService.extractFrame).not.toHaveBeenCalled();
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should let transient failures propagate as retryable errors', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo('processing'));
      const transient = new ProcessExecutionError('ffprobe', null, '', true);
      mediaProbeService.probe.mockRejectedValue(transient);

      await expect(service.process(VIDEO_ID)).rejects.toBe(transient);
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should not mark the video ready when the thumbnail extraction fails', async () => {
      videoRepository.findOneBy.mockResolvedValue(buildVideo('processing'));
      mediaProbeService.probe.mockResolvedValue({
        durationSeconds: 10,
        metadata: {
          formatName: 'mp4',
          bitRate: null,
          width: 640,
          height: 360,
          frameRate: 30,
          videoCodec: 'h264',
          audioCodec: null,
        },
      });
      thumbnailService.computeOffset.mockReturnValue(1);
      thumbnailService.extractFrame.mockRejectedValue(
        new ProcessExecutionError('ffmpeg', 1, 'boom', false),
      );

      await expect(service.process(VIDEO_ID)).rejects.toThrow(
        ProcessExecutionError,
      );

      expect(thumbnailService.computeOffset).toHaveBeenCalledWith(10);
      expect(thumbnailService.extractFrame).toHaveBeenCalledWith(
        SOURCE_URL,
        1,
        expect.stringMatching(/thumbnail\.jpg$/),
      );
      expect(storageService.putObject).not.toHaveBeenCalled();
      expect(videoRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('markFailed', () => {
    it('should only update a video that is still processing', async () => {
      await service.markFailed(VIDEO_ID, 'PROCESSING_FAILED');

      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: VIDEO_ID, status: 'processing' },
        { status: 'failed', failure_reason: 'PROCESSING_FAILED' },
      );
    });
  });
});
