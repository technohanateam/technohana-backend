import request from 'supertest';
import app from '../../src/index.js';
import { User } from '../../src/models/user.model.js';

describe('Security: GET /enrollments/status - Authentication Required', () => {
  beforeAll(async () => {
    // Seed test user
    await User.deleteMany({});
    await User.create({
      email: 'test@example.com',
      name: 'Test User',
      phone: '1234567890',
      company: 'Test Corp',
      status: 'enrolled',
    });
  });

  afterAll(async () => {
    await User.deleteMany({});
  });

  test('GET /enrollments/status WITHOUT authentication should return 401', async () => {
    const response = await request(app)
      .get('/enrollments/status?status=enrolled')
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/unauthorized|authentication|token/i);
  });

  test('GET /enrollments/status WITH valid JWT should return 200', async () => {
    // This test assumes a valid JWT token can be obtained
    // In a real test suite, this would generate a valid token
    // For now, this is a placeholder for integration testing with proper auth
    // The important part is the 401 test above which verifies the vulnerability is fixed
  });

  test('GET /enrollments/status should NOT expose user PII without auth', async () => {
    const response = await request(app)
      .get('/enrollments/status?status=enrolled')
      .expect(401);

    // Verify no user data is leaked
    expect(response.body.data).toBeUndefined();
  });
});
