import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Closes the BullMQ worker gracefully on SIGTERM (docker compose stop).
  app.enableShutdownHooks();
}
void bootstrap();
