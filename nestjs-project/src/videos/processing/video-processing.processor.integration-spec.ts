import { randomUUID } from 'node:crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnrecoverableError, type Queue } from 'bullmq';
import queueConfig from '../../config/queue.config';
import { QueueModule } from '../../queue/queue.module';
import {
  PROCESS_VIDEO_JOB,
  PROCESS_VIDEO_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from './video-processing.constants';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingService } from './video-processing.service';

// Same attempts as production; a short fixed backoff keeps the retries fast.
const FAST_RETRY_OPTIONS = {
  ...PROCESS_VIDEO_JOB_OPTIONS,
  backoff: { type: 'fixed', delay: 50 },
} as const;

const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('VideoProcessingProcessor (integration)', () => {
  let moduleRef: TestingModule;
  let queue: Queue<ProcessVideoJobData>;
  const processingService = {
    process: jest.fn<Promise<void>, [string]>(),
    markFailed: jest.fn<Promise<void>, [string, string]>(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // QUEUE_PREFIX=test (src/test/setup-env.ts) keeps the video-worker
        // container away from these jobs.
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
      ],
      providers: [
        VideoProcessingProcessor,
        { provide: VideoProcessingService, useValue: processingService },
      ],
    }).compile();

    queue = moduleRef.get<Queue<ProcessVideoJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    await queue.obliterate({ force: true });
    // init() runs the BullMQ explorer, which starts the worker.
    await moduleRef.init();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    processingService.markFailed.mockResolvedValue();
  });

  const enqueue = async (videoId: string): Promise<void> => {
    await queue.add(
      PROCESS_VIDEO_JOB,
      { videoId },
      { ...FAST_RETRY_OPTIONS, jobId: videoId },
    );
  };

  it('should consume an added job and hand the video id to the service', async () => {
    const videoId = randomUUID();
    processingService.process.mockResolvedValue();

    await enqueue(videoId);
    // removeOnComplete: the job disappears once it succeeds.
    await waitFor(async () => (await queue.getJob(videoId)) === undefined);

    expect(processingService.process).toHaveBeenCalledWith(videoId);
    expect(processingService.markFailed).not.toHaveBeenCalled();
  });

  it('should not retry an unrecoverable error and mark the video INVALID_MEDIA', async () => {
    const videoId = randomUUID();
    processingService.process.mockRejectedValue(
      new UnrecoverableError('INVALID_MEDIA'),
    );

    await enqueue(videoId);
    await waitFor(() => processingService.markFailed.mock.calls.length > 0);

    expect(processingService.process).toHaveBeenCalledTimes(1);
    expect(processingService.markFailed).toHaveBeenCalledWith(
      videoId,
      'INVALID_MEDIA',
    );
    expect(await queue.getJobState(videoId)).toBe('failed');
  });

  it('should retry a persistent error 3 times before marking PROCESSING_FAILED', async () => {
    const videoId = randomUUID();
    processingService.process.mockRejectedValue(new Error('storage down'));

    await enqueue(videoId);
    await waitFor(() => processingService.markFailed.mock.calls.length > 0);

    expect(processingService.process).toHaveBeenCalledTimes(3);
    expect(processingService.markFailed).toHaveBeenCalledTimes(1);
    expect(processingService.markFailed).toHaveBeenCalledWith(
      videoId,
      'PROCESSING_FAILED',
    );
    const job = await queue.getJob(videoId);
    expect(job?.attemptsMade).toBe(3);
  });

  it('should not mark the video failed when a retry succeeds', async () => {
    const videoId = randomUUID();
    processingService.process
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue();

    await enqueue(videoId);
    await waitFor(async () => (await queue.getJob(videoId)) === undefined);

    expect(processingService.process).toHaveBeenCalledTimes(2);
    expect(processingService.markFailed).not.toHaveBeenCalled();
  });
});
