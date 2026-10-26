import { Test } from '@nestjs/testing';
import { PROCESS_RUNNER } from './media.constants';
import type { ProcessRunner } from './process-runner';
import { ThumbnailService } from './thumbnail.service';

describe('ThumbnailService', () => {
  let service: ThumbnailService;
  let runner: jest.MockedFunction<ProcessRunner>;

  beforeEach(async () => {
    runner = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ThumbnailService,
        { provide: PROCESS_RUNNER, useValue: runner },
      ],
    }).compile();
    service = moduleRef.get(ThumbnailService);
  });

  describe('computeOffset', () => {
    it('should return 10% of the duration', () => {
      expect(service.computeOffset(100)).toBe(10);
    });

    it('should return 0 for durations shorter than 1 second', () => {
      expect(service.computeOffset(0.5)).toBe(0);
    });

    it('should return 0 when the duration is unknown', () => {
      expect(service.computeOffset(null)).toBe(0);
    });
  });

  describe('extractFrame', () => {
    it('should seek, take one frame and cap the width at 1280', async () => {
      await service.extractFrame('/in/source.mp4', 10, '/out/thumb.jpg');

      const [command, args] = runner.mock.calls[0];
      expect(command).toBe('ffmpeg');
      expect(args).toEqual(
        expect.arrayContaining(['-ss', '10', '-i', '/in/source.mp4']),
      );
      expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
      expect(args.join(' ')).toContain('-frames:v 1');
      expect(args.join(' ')).toContain("-vf scale='min(1280,iw)':-2");
      expect(args.join(' ')).toContain('-q:v 2');
      expect(args.at(-1)).toBe('/out/thumb.jpg');
    });

    it('should pass paths with spaces or ";" as single arguments', async () => {
      const input = '/in/my video; rm -rf ~.mp4';
      const output = '/out/my thumb;.jpg';

      await service.extractFrame(input, 0, output);

      const [, args] = runner.mock.calls[0];
      expect(args[args.indexOf('-i') + 1]).toBe(input);
      expect(args.at(-1)).toBe(output);
    });
  });
});
