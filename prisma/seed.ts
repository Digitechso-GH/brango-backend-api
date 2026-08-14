import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando siembra limpia de base de datos...');

  console.log('Limpiando todas las tablas existentes...');
  await prisma.orderEvent.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.locationSnapshot.deleteMany();
  await prisma.routeAssignment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.company.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driverProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

  console.log('Creando roles del sistema...');
  const adminRole = await prisma.role.create({
    data: {
      code: 'SYS_ADMIN',
      name: 'Administrador',
    },
  });

  await prisma.role.createMany({
    data: [
      { code: 'SYS_OPERATOR', name: 'Operador' },
      { code: 'SYS_DRIVER', name: 'Conductor' },
    ],
  });

  console.log('Creando usuario único Administrador por defecto...');
  const defaultEmail = process.env.ADMIN_SEED_EMAIL || 'admin@brango.com';
  const defaultPassword = process.env.ADMIN_SEED_PASSWORD || 'admin123';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  await prisma.user.create({
    data: {
      email: defaultEmail,
      name: 'Administrador BranGo',
      password: hashedPassword,
      roleId: adminRole.id,
    },
  });

  console.log('----------------------------------------------------');
  console.log('✅ Base de datos limpiada y sembrada con éxito.');
  console.log(`👤 Usuario Admin: ${defaultEmail}`);
  console.log(`🔑 Contraseña: ${defaultPassword}`);
  console.log('📦 Pedidos existentes: 0');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Error durante la siembra:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
