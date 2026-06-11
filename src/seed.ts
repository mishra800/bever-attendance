import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './database';

async function seed() {
  console.log('🌱 Seeding Supabase database...');

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', 'admin@company.com')
    .single();

  if (!existing) {
    const { error } = await supabase.from('admin_users').insert({
      id: uuidv4(),
      name: 'Admin',
      email: 'admin@company.com',
      password: hash('admin123'),
      role: 'admin',
    });

    if (error) {
      console.error('❌ Failed to create admin:', error.message);
      process.exit(1);
    }
    console.log('✅ Admin created: admin@company.com / admin123');
  } else {
    console.log('ℹ️  Admin already exists');
  }

  console.log('\n📋 Admin login:');
  console.log('  Email:    admin@company.com');
  console.log('  Password: admin123');
  console.log('\n💡 After login, go to Employees → Add Employee to register staff with face photos.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
