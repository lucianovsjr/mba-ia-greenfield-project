import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  // Redis key namespace of the queues; tests use their own (src/test/setup-env.ts).
  prefix: process.env.QUEUE_PREFIX || 'bull',
}));
