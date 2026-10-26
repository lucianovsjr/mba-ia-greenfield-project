import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('should compile and connect queues to the configured Redis', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
        BullModule.registerQueue({ name: 'queue-module-spec' }),
      ],
    }).compile();

    const queue = moduleRef.get<Queue>(getQueueToken('queue-module-spec'));
    const config = queueConfig();
    expect(queue.opts.connection).toMatchObject({
      host: config.redisHost,
      port: config.redisPort,
    });

    await moduleRef.close();
  });
});
