// Runs after dotenv/config. Tests publish to their own queue namespace so the
// video-worker container (default prefix) never consumes test jobs.
process.env.QUEUE_PREFIX = 'test';
