import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import queueConfig from './config/queue.config';
import storageConfig from './config/storage.config';
import { envValidationSchema } from './config/env.validation';
import { MediaModule } from './media/media.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { Video } from './videos/entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from './videos/processing/video-processing.constants';
import { VideoProcessingProcessor } from './videos/processing/video-processing.processor';
import { VideoProcessingService } from './videos/processing/video-processing.service';

// Root module of the video worker process (src/worker.ts): consumer side of
// the queue only, no HTTP layer.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, storageConfig, queueConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video]),
    // Registers User and Channel: Video's relations need their metadata.
    UsersModule,
    QueueModule,
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    StorageModule,
    MediaModule,
  ],
  providers: [VideoProcessingService, VideoProcessingProcessor],
})
export class WorkerModule {}
