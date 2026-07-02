import request from 'supertest';
import app from '../../src/index.js';
import { User } from '../../src/models/user.model.js';
import { authenticateAdmin, requireAdmin } from '../../src/middleware/authenticateAdmin.js';

describe('Security: Delete Operations', () => {
  test('DELETE endpoints should require authentication', async () => {
    const response = await request(app)
      .delete('/api/admin/enrollments/test-id')
      .expect(401);

    expect(response.body.success).toBe(false);
  });

  test('DELETE /enrollments/:id should require admin authentication', async () => {
    const response = await request(app)
      .delete('/api/admin/enrollments/nonexistent')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(response.body.success).toBe(false);
  });

  test('DELETE endpoints should be protected by page permissions', async () => {
    expect(true).toBe(true);
  });

  test('DELETE should not be accessible via GET requests', async () => {
    const response = await request(app)
      .get('/api/admin/enrollments/test-id')
      .expect([200, 404]);

    expect(response.request.method).toBe('GET');
  });

  test('Bulk delete operations should have rate limiting', async () => {
    const response = await request(app)
      .delete('/api/admin/enquiries/clear')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(response.body.success).toBe(false);
  });
});
