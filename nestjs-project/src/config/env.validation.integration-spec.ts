import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({}) as {
      value: { SWAGGER_ENABLED: string };
      error?: Error;
    };
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage, queue and videos', () => {
  const validateWithout = (key: string) => {
    const env: Record<string, string> = { ...requiredEnv };
    delete env[key];
    return envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });
  };

  it.each(['S3_ACCESS_KEY', 'S3_SECRET_KEY'])(
    'should reject a missing %s',
    (key) => {
      const { error } = validateWithout(key);
      expect(error).toBeDefined();
      expect(error!.message).toContain(key);
    },
  );

  it('should apply the Compose-compatible defaults', () => {
    const { value, error } = validate({}) as {
      value: Record<string, string | number>;
      error?: Error;
    };
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'streamtube-videos',
      REDIS_HOST: 'redis',
      REDIS_PORT: 6379,
      QUEUE_PREFIX: 'bull',
      VIDEO_MAX_SIZE_BYTES: 10737418240,
      UPLOAD_PART_SIZE_BYTES: 104857600,
      UPLOAD_PART_URL_TTL_SECONDS: 3600,
      PLAYBACK_URL_TTL_SECONDS: 900,
    });
  });

  it('should reject an upload part size below the 5 MiB S3 minimum', () => {
    const { error } = validate({ UPLOAD_PART_SIZE_BYTES: '1048576' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('UPLOAD_PART_SIZE_BYTES');
  });

  it('should coerce numeric strings from the environment', () => {
    const { value, error } = validate({ REDIS_PORT: '6380' }) as {
      value: { REDIS_PORT: number };
      error?: Error;
    };
    expect(error).toBeUndefined();
    expect(value.REDIS_PORT).toBe(6380);
  });
});
