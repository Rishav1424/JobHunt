import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.$connect()
  .then(() => {
    console.log('✅ Connected successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Failed to connect:', err);
    process.exit(1);
  });
