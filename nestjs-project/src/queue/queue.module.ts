import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import queueConfig from '../config/queue.config';

// Shared BullMQ connection (Redis) for the API (producers) and the worker (consumers).
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: { host: config.redisHost, port: config.redisPort },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
