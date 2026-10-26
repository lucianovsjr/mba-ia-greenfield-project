import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import * as publicIdUtil from './public-id.util';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let storage: StorageService;
  let videoRepository: Repository<Video>;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videosConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    videosService = moduleRef.get(VideosService);
    storage = moduleRef.get(StorageService);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: 'video_owner@example.com',
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'video_owner',
      nickname: 'video_owner',
      user_id: user.id,
    });
    userId = user.id;
    channelId = channel.id;
  });

  const initiate = () =>
    videosService.initiateUpload(userId, {
      title: 'Integration video',
      filename: 'clip.mp4',
      size: 5242880,
      contentType: 'video/mp4',
    });

  it('should persist a draft linked to the caller channel with an open multipart upload', async () => {
    const result = await initiate();

    const row = await videoRepository.findOneByOrFail({
      public_id: result.video.public_id,
    });
    expect(row.status).toBe('draft');
    expect(row.channel_id).toBe(channelId);
    expect(row.title).toBe('Integration video');
    expect(row.source_key).toBe(`videos/${row.id}/source`);
    expect(row.upload_id).toEqual(expect.any(String));
    // The multipart upload really exists in MinIO (ListParts would fail otherwise).
    await expect(
      storage.listParts(row.source_key, row.upload_id!),
    ).resolves.toEqual([]);
    await storage.abortMultipartUpload(row.source_key, row.upload_id!);
  });

  it('should resolve a public_id collision with a new id', async () => {
    const first = await initiate();
    const original = publicIdUtil.generatePublicId;
    jest
      .spyOn(publicIdUtil, 'generatePublicId')
      .mockReturnValueOnce(first.video.public_id)
      .mockImplementation(original);

    const second = await initiate();

    expect(second.video.public_id).not.toBe(first.video.public_id);
    expect(await videoRepository.count()).toBe(2);
    for (const row of await videoRepository.find()) {
      await storage.abortMultipartUpload(row.source_key, row.upload_id!);
    }
  });
});
