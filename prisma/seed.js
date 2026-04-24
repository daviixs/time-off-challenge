require('dotenv/config');

const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client');

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.employee.upsert({
    where: { id: 'emp-001' },
    update: {
      name: 'Employee One',
      email: 'emp-001@example.com',
      role: 'EMPLOYEE',
    },
    create: {
      id: 'emp-001',
      name: 'Employee One',
      email: 'emp-001@example.com',
      role: 'EMPLOYEE',
    },
  });

  await prisma.employee.upsert({
    where: { id: 'mgr-001' },
    update: {
      name: 'Manager One',
      email: 'mgr-001@example.com',
      role: 'MANAGER',
    },
    create: {
      id: 'mgr-001',
      name: 'Manager One',
      email: 'mgr-001@example.com',
      role: 'MANAGER',
    },
  });

  console.log('Seeded employees: emp-001, mgr-001');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
