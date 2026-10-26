import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';
import { STORAGE_PRESIGN_CLIENT, STORAGE_S3_CLIENT } from './storage.constants';

describe('StorageModule', () => {
  it('should compile and provide StorageService with both S3 clients', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    expect(moduleRef.get(StorageService)).toBeInstanceOf(StorageService);
    const internal = moduleRef.get<S3Client>(STORAGE_S3_CLIENT);
    const presign = moduleRef.get<S3Client>(STORAGE_PRESIGN_CLIENT);
    expect(internal).toBeInstanceOf(S3Client);
    expect(presign).toBeInstanceOf(S3Client);
    expect(internal).not.toBe(presign);

    await moduleRef.close();
  });
});
