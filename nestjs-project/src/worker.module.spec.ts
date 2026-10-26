import { Test } from '@nestjs/testing';
import { VideoProcessingProcessor } from './videos/processing/video-processing.processor';
import { VideoProcessingService } from './videos/processing/video-processing.service';
import { VideosController } from './videos/videos.controller';
import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('should compile with the processor wired and no HTTP layer', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(moduleRef.get(VideoProcessingService)).toBeInstanceOf(
      VideoProcessingService,
    );
    expect(moduleRef.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
    expect(() => moduleRef.get(VideosController)).toThrow();

    await moduleRef.close();
  }, 30000);
});
