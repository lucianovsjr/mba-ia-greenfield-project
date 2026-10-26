import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  it('should return an 11-character base64url string', () => {
    const id = generatePublicId();

    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it('should return distinct values across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicId()));

    expect(ids.size).toBe(1000);
  });
});
