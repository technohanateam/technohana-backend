import axios from 'axios';
import fs from 'fs';

const ADMIN_EMAIL = 'admin@technohana.in';
const ADMIN_PASSWORD = 'TechnoHana@Admin2024';
const API_BASE = 'http://localhost:5000';

async function seed() {
  try {
    // Step 1: Login
    console.log('🔐 Logging in as admin...');
    const loginRes = await axios.post(`${API_BASE}/admin/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    
    const token = loginRes.data.token;
    console.log('✅ Login successful');
    
    // Step 2: Seed courses with force=true to reseed
    console.log('\n📚 Seeding courses (force=true to reseed all)...');
    const seedRes = await axios.post(
      `${API_BASE}/admin/courses/seed`,
      { force: true },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    console.log('\n✅ Seed Result:');
    console.log(JSON.stringify(seedRes.data, null, 2));
    
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    process.exit(1);
  }
}

seed();
