import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { MailService } from '../../src/mail/mail.service';

// Boots AppModule with the same global pipes/filters as main.ts.
export async function createE2eApp(
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<INestApplication<App>> {
  const moduleFixture = await customize(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

// Registers a user, confirms the email (token captured from MailService) and
// logs in, returning the access token. Clears the auth rate limiter first.
export async function createAuthenticatedUser(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();

  // MailService is a singleton, so this is the instance AuthService calls.
  let token = '';
  jest
    .spyOn(app.get(MailService), 'sendConfirmationEmail')
    .mockImplementationOnce((_email: string, _name: string, raw: string) => {
      token = raw;
      return Promise.resolve();
    });

  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token })
    .expect(204);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return (res.body as { access_token: string }).access_token;
}
