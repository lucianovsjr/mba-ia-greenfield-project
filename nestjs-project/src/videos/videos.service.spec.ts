import { Test } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import {
  UnsupportedVideoFormatException,
  VideoTooLargeException,
} from './exceptions/video.exceptions';
import * as publicIdUtil from './public-id.util';
import { MAX_PUBLIC_ID_ATTEMPTS } from './videos.constants';
import { VideosService } from './videos.service';

const CONFIG = {
  maxSizeBytes: 10737418240,
  uploadPartSizeBytes: 104857600,
  uploadPartUrlTtlSeconds: 3600,
  playbackUrlTtlSeconds: 900,
};

const validDto = (
  overrides: Partial<InitiateUploadDto> = {},
): InitiateUploadDto => ({
  title: 'My video',
  filename: 'clip.mp4',
  size: 5242880,
  contentType: 'video/mp4',
  ...overrides,
});

const uniqueViolation = (): QueryFailedError => {
  const err = new QueryFailedError('INSERT', [], new Error('duplicate'));
  Object.assign(err, {
    code: '23505',
    detail: 'Key (public_id)=(AAAAAAAAAAA) already exists.',
  });
  return err;
};

describe('VideosService', () => {
  let service: VideosService;
  const manager = {
    query: jest.fn(),
    create: jest.fn((_entity: unknown, fields: Record<string, unknown>) => ({
      ...fields,
    })),
    save: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };
  const storage = {
    createMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
  };
  const channels = { findByUserId: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    storage.createMultipartUpload.mockResolvedValue('upload-1');
    channels.findByUserId.mockResolvedValue({ id: 'channel-1' });
    manager.save.mockImplementation((video: Record<string, unknown>) =>
      Promise.resolve({
        ...video,
        thumbnail_key: null,
        duration_seconds: null,
        metadata: null,
        failure_reason: null,
        created_at: new Date('2026-10-25T00:00:00Z'),
        updated_at: new Date('2026-10-25T00:00:00Z'),
      }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: DataSource, useValue: dataSource },
        { provide: StorageService, useValue: storage },
        { provide: ChannelsService, useValue: channels },
        { provide: videosConfig.KEY, useValue: CONFIG },
      ],
    }).compile();
    service = moduleRef.get(VideosService);
  });

  describe('initiateUpload', () => {
    it('should create a draft and return the upload plan', async () => {
      const result = await service.initiateUpload('user-1', validDto());

      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^videos\/[0-9a-f-]{36}\/source$/),
        'video/mp4',
      );
      expect(result.video.status).toBe('draft');
      expect(result.video.title).toBe('My video');
      expect(result.upload).toEqual({
        part_size_bytes: 104857600,
        part_count: 1,
        max_part_urls_per_request: 100,
      });
    });

    it('should compute part_count by ceiling size over part size', async () => {
      const result = await service.initiateUpload(
        'user-1',
        validDto({ size: 104857600 * 2 + 1 }),
      );

      expect(result.upload.part_count).toBe(3);
    });

    it.each([
      ['clip.MOV', 'video/quicktime'],
      ['clip.mpg', 'video/mpeg'],
      ['clip.mpeg', 'video/mpeg'],
      ['clip.avi', 'video/x-msvideo'],
    ])('should accept %s with %s', async (filename, contentType) => {
      await expect(
        service.initiateUpload('user-1', validDto({ filename, contentType })),
      ).resolves.toBeDefined();
    });

    it('should reject an extension outside the allowlist', async () => {
      await expect(
        service.initiateUpload(
          'user-1',
          validDto({ filename: 'clip.mkv', contentType: 'video/x-matroska' }),
        ),
      ).rejects.toBeInstanceOf(UnsupportedVideoFormatException);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should reject a MIME type that does not match the extension', async () => {
      await expect(
        service.initiateUpload(
          'user-1',
          validDto({ filename: 'clip.mp4', contentType: 'video/quicktime' }),
        ),
      ).rejects.toBeInstanceOf(UnsupportedVideoFormatException);
    });

    it('should reject a size above the maximum', async () => {
      await expect(
        service.initiateUpload(
          'user-1',
          validDto({ size: CONFIG.maxSizeBytes + 1 }),
        ),
      ).rejects.toBeInstanceOf(VideoTooLargeException);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should regenerate public_id after a unique violation', async () => {
      const generate = jest
        .spyOn(publicIdUtil, 'generatePublicId')
        .mockReturnValueOnce('AAAAAAAAAAA')
        .mockReturnValueOnce('BBBBBBBBBBB');
      manager.save.mockRejectedValueOnce(uniqueViolation());

      const result = await service.initiateUpload('user-1', validDto());

      expect(generate).toHaveBeenCalledTimes(2);
      expect(result.video.public_id).toBe('BBBBBBBBBBB');
      expect(manager.query).toHaveBeenCalledWith(
        'ROLLBACK TO SAVEPOINT public_id_attempt_0',
      );
    });

    it('should abort the multipart upload when the draft cannot be stored', async () => {
      manager.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.initiateUpload('user-1', validDto()),
      ).rejects.toThrow('db down');
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^videos\/.+\/source$/),
        'upload-1',
      );
    });

    it('should give up after the maximum number of public_id collisions', async () => {
      manager.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.initiateUpload('user-1', validDto()),
      ).rejects.toThrow(/public_id collision/);
      expect(manager.save).toHaveBeenCalledTimes(MAX_PUBLIC_ID_ATTEMPTS);
      expect(storage.abortMultipartUpload).toHaveBeenCalled();
    });
  });
});
