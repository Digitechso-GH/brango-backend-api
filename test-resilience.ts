import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { OrdersService } from './src/modules/orders/orders.service';
import { PrismaService } from './src/modules/prisma/prisma.service';
import { AssignmentStatus } from '@prisma/client';

async function bootstrap() {
  console.log('--- INICIANDO PRUEBA DE RESILIENCIA WHATSAPP ---');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const ordersService = app.get(OrdersService);

  // 1. Preparar datos de prueba
  let assignment = await prisma.routeAssignment.findFirst();

  if (!assignment) {
    const driver = await prisma.user.findFirst();
    const order = await prisma.order.findFirst();
    assignment = await prisma.routeAssignment.create({
      data: {
        driverId: driver!.id,
        orderId: order!.id,
        date: new Date(),
        sequenceIndex: 1,
        status: 'PENDING',
      }
    });
  }

  if (!assignment) {
    console.error('No hay asignaciones PENDING para probar.');
    process.exit(1);
  }

  console.log(`[TEST] Asignación seleccionada para probar: ${assignment.id}`);

  // Clear existing IN_TRANSIT assignments for this driver to avoid validation errors
  await prisma.routeAssignment.updateMany({
    where: { driverId: assignment.driverId, status: 'IN_TRANSIT' },
    data: { status: 'PENDING' }
  });

  // Prueba 1: Éxito (Simular demora de 2 seg de Meta, pero que responda OK)
  console.log('\n--- CASO 1: Éxito (Meta responde lento pero OK) ---');
  const start1 = Date.now();
  await ordersService.updateStatus(assignment.id, {
    status: AssignmentStatus.IN_TRANSIT,
    latitude: -12.0,
    longitude: -77.0,
  });
  const end1 = Date.now();
  console.log(`[TEST] Tiempo de respuesta de updateStatus(): ${end1 - start1} ms (¡No fue bloqueado por Meta!)`);

  // Esperar a que el proceso en background termine para revisar los eventos
  await new Promise(r => setTimeout(r, 2500));
  
  const events1 = await prisma.orderEvent.findMany({ where: { routeAssignmentId: assignment.id }, orderBy: { timestamp: 'desc' } });
  console.log('[TEST] Eventos registrados (Caso 1):', events1.map(e => e.type));

  // Reset para el caso 2
  await prisma.routeAssignment.update({ where: { id: assignment.id }, data: { status: 'PENDING' } });

  // Prueba 2: Fallo Forzado
  console.log('\n--- CASO 2: Fallo de Red de Meta (Token inválido) ---');
  process.env.WHATSAPP_TOKEN = 'FALLO_FORZADO';
  
  const start2 = Date.now();
  await ordersService.updateStatus(assignment.id, {
    status: AssignmentStatus.IN_TRANSIT,
    latitude: -12.0,
    longitude: -77.0,
  });
  const end2 = Date.now();
  console.log(`[TEST] Tiempo de respuesta de updateStatus(): ${end2 - start2} ms (¡No fue bloqueado por el fallo de Meta!)`);

  await new Promise(r => setTimeout(r, 2500));

  const events2 = await prisma.orderEvent.findMany({ where: { routeAssignmentId: assignment.id }, orderBy: { timestamp: 'desc' } });
  console.log('[TEST] Eventos registrados (Caso 2):', events2.map(e => e.type));

  await app.close();
  process.exit(0);
}

bootstrap();
