import { randomBytes } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `video_chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channel: Channel, overrides: Partial<Video> = {}) {
    return videoRepository.create({
      public_id: randomBytes(8).toString('base64url'),
      channel_id: channel.id,
      title: 'My video',
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 5242880,
      source_key: 'videos/placeholder/source',
      ...overrides,
    });
  }

  it('should enforce unique public_id', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel, { public_id: 'AAAAAAAAAAA' }),
    );

    await expect(
      videoRepository.save(buildVideo(channel, { public_id: 'AAAAAAAAAAA' })),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('should default status to draft and leave processing fields null', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.status).toBe('draft');
    expect(found.thumbnail_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.metadata).toBeNull();
    expect(found.failure_reason).toBeNull();
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
  });

  it('should reject a status outside the enum', async () => {
    const channel = await createChannel();
    const video = buildVideo(channel);
    (video as unknown as { status: string }).status = 'published';

    await expect(videoRepository.save(video)).rejects.toThrow(
      /invalid input value for enum videos_status_enum/,
    );
  });

  it('should delete videos when their channel is removed', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    await channelRepository.delete({ id: channel.id });

    expect(await videoRepository.findOneBy({ id: saved.id })).toBeNull();
  });

  it('should round-trip size_bytes above 2^32 as a number', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(
      buildVideo(channel, { size_bytes: 10737418240 }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.size_bytes).toBe(10737418240);
    expect(typeof found.size_bytes).toBe('number');
  });

  it('should store and read metadata as JSONB', async () => {
    const channel = await createChannel();
    const metadata = {
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitRate: 1200000,
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
    };
    const saved = await videoRepository.save(
      buildVideo(channel, { metadata, duration_seconds: 12.5 }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.metadata).toEqual(metadata);
    expect(found.duration_seconds).toBe(12.5);
  });

  it('should require an existing channel', async () => {
    const channel = await createChannel();
    const orphan = buildVideo(channel, {
      channel_id: '00000000-0000-4000-8000-000000000000',
    });

    await expect(videoRepository.save(orphan)).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });
});
