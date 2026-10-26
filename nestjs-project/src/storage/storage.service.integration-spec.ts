import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';
import { StoragePartsRejectedError } from './storage.errors';

const MIB = 1024 * 1024;

const buildModule = (
  overrides: Partial<ConfigType<typeof storageConfig>> = {},
): Promise<TestingModule> =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      StorageModule,
    ],
  })
    .overrideProvider(storageConfig.KEY)
    .useValue({ ...storageConfig(), ...overrides })
    .compile();

const putPart = async (url: string, body: Buffer): Promise<string> => {
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
  });
  expect(response.status).toBe(200);
  const etag = response.headers.get('etag');
  expect(etag).toBeTruthy();
  return etag!;
};

describe('StorageService (integration)', () => {
  let moduleRef: TestingModule;
  let storage: StorageService;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    // Presigned URLs must be reachable from inside the container, so the
    // public endpoint points at the Compose service name in this suite.
    moduleRef = await buildModule({ publicEndpoint: storageConfig().endpoint });
    storage = moduleRef.get(StorageService);
  });

  afterAll(async () => {
    for (const key of createdKeys) {
      await storage.deleteObject(key);
    }
    await moduleRef.close();
  });

  const newKey = (): string => {
    const key = `test/${randomUUID()}/source`;
    createdKeys.push(key);
    return key;
  };

  const uploadTwoParts = async (key: string) => {
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    const first = Buffer.alloc(5 * MIB, 1);
    const second = Buffer.alloc(1024, 2);
    const etag1 = await putPart(
      await storage.presignUploadPart(key, uploadId, 1, 60),
      first,
    );
    const etag2 = await putPart(
      await storage.presignUploadPart(key, uploadId, 2, 60),
      second,
    );
    return { uploadId, etag1, etag2, total: first.length + second.length };
  };

  it('should complete a multipart upload sent through presigned part URLs', async () => {
    const key = newKey();
    const { uploadId, etag1, etag2, total } = await uploadTwoParts(key);

    await storage.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag1 },
      { partNumber: 2, etag: etag2 },
    ]);

    expect(await storage.headObject(key)).toBe(total);
  });

  it('should list uploaded parts before completion', async () => {
    const key = newKey();
    const { uploadId, etag1, etag2 } = await uploadTwoParts(key);

    const parts = await storage.listParts(key, uploadId);

    expect(parts).toEqual([
      { partNumber: 1, etag: etag1, sizeBytes: 5 * MIB },
      { partNumber: 2, etag: etag2, sizeBytes: 1024 },
    ]);
    await storage.abortMultipartUpload(key, uploadId);
  });

  it('should serve Range requests with 206 through a presigned GET URL', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.alloc(4096, 7), 'video/mp4');

    const url = await storage.presignGetObject(key, {
      expiresIn: 60,
      endpoint: 'internal',
    });
    const response = await fetch(url, { headers: { Range: 'bytes=0-99' } });

    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(100);
  });

  it('should return the requested Content-Disposition on a presigned GET URL', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.from('video-bytes'), 'video/mp4');
    const disposition = 'attachment; filename="clip.mp4"';

    const url = await storage.presignGetObject(key, {
      expiresIn: 60,
      endpoint: 'internal',
      responseContentDisposition: disposition,
    });
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(disposition);
  });

  it('should raise StoragePartsRejectedError when completing with a wrong ETag', async () => {
    const key = newKey();
    const { uploadId, etag2 } = await uploadTwoParts(key);

    await expect(
      storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: '"00000000000000000000000000000000"' },
        { partNumber: 2, etag: etag2 },
      ]),
    ).rejects.toBeInstanceOf(StoragePartsRejectedError);
    await storage.abortMultipartUpload(key, uploadId);
  });

  it('should fail listing parts with NoSuchUpload after an abort', async () => {
    const key = newKey();
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    await storage.abortMultipartUpload(key, uploadId);

    await expect(storage.listParts(key, uploadId)).rejects.toMatchObject({
      name: 'NoSuchUpload',
    });
  });

  it('should sign public URLs with S3_PUBLIC_ENDPOINT and internal URLs with S3_ENDPOINT', async () => {
    const config = storageConfig();
    const defaultModule = await buildModule();
    const defaultStorage = defaultModule.get(StorageService);

    const publicUrl = new URL(
      await defaultStorage.presignGetObject('any/key', {
        expiresIn: 60,
        endpoint: 'public',
      }),
    );
    const internalUrl = new URL(
      await defaultStorage.presignGetObject('any/key', {
        expiresIn: 60,
        endpoint: 'internal',
      }),
    );
    const partUrl = new URL(
      await defaultStorage.presignUploadPart('any/key', 'upload-id', 1, 60),
    );

    expect(publicUrl.host).toBe(new URL(config.publicEndpoint).host);
    expect(partUrl.host).toBe(new URL(config.publicEndpoint).host);
    expect(internalUrl.host).toBe(new URL(config.endpoint).host);
    await defaultModule.close();
  });
});
