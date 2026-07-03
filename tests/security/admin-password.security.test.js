import request from 'supertest';
import app from '../../src/index.js';
import AdminUser from '../../src/models/adminUser.model.js';
import bcrypt from 'bcryptjs';

describe('Security: Admin Password Hashing', () => {
  beforeAll(async () => {
    await AdminUser.deleteMany({});
  });

  afterAll(async () => {
    await AdminUser.deleteMany({});
  });

  test('POST /admin/login should NOT accept plaintext password comparison', async () => {
    const password = 'testPassword123';
    const passwordHash = await bcrypt.hash(password, 10);

    await AdminUser.create({
      email: 'admin@example.com',
      name: 'Test Admin',
      passwordHash,
      role: 'admin',
      active: true,
    });

    const response = await request(app)
      .post('/admin/login')
      .send({
        email: 'admin@example.com',
        password: 'wrongPassword',
      });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/Invalid credentials/i);
  });

  test('POST /admin/login should use bcrypt.compare for password verification', async () => {
    const password = 'testPassword123';
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await AdminUser.create({
      email: 'admin2@example.com',
      name: 'Test Admin 2',
      passwordHash,
      role: 'admin',
      active: true,
    });

    const response = await request(app)
      .post('/admin/login')
      .send({
        email: 'admin2@example.com',
        password: password,
      });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  test('Password reset should use bcrypt hashing', async () => {
    const originalPassword = 'testPassword123';
    const originalHash = await bcrypt.hash(originalPassword, 10);

    const user = await AdminUser.create({
      email: 'admin3@example.com',
      name: 'Test Admin 3',
      passwordHash: originalHash,
      role: 'admin',
      active: true,
    });

    const newPassword = 'newPassword456';
    const loginResponse = await request(app)
      .post('/admin/login')
      .send({
        email: 'admin3@example.com',
        password: originalPassword,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.token).toBeDefined();

    const token = loginResponse.body.token;

    const resetResponse = await request(app)
      .patch(`/admin/users/${user._id}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        password: newPassword,
      });

    expect(resetResponse.status).toBe(200);

    const loginAfterReset = await request(app)
      .post('/admin/login')
      .send({
        email: 'admin3@example.com',
        password: newPassword,
      });

    expect(loginAfterReset.status).toBe(200);
    expect(loginAfterReset.body.token).toBeDefined();
  });
});
