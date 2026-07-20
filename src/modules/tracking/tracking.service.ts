import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LOCATION_EVENTS } from './tracking.constants';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSnapshot(
    driverId: string,
    latitud: number,
    longitud: number,
    evento?: string,
    pedidoId?: string,
  ) {
    // Si es un evento clave de negocio, lo guardamos inmediatamente
    if (evento && evento !== LOCATION_EVENTS.INTERVAL_30_SEC) {
      return this.prisma.locationSnapshot.create({
        data: {
          driverId,
          latitud,
          longitud,
          evento,
          pedidoId: pedidoId || null,
        },
      });
    }

    // Si es una coordenada de intervalo rutinario (throttling):
    // Verificamos la marca de tiempo del último snapshot de este chofer
    const lastSnapshot = await this.prisma.locationSnapshot.findFirst({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastSnapshot) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (lastSnapshot.createdAt > fiveMinutesAgo) {
        // Ignoramos la escritura en base de datos si fue hace menos de 5 minutos
        return null;
      }
    }

    // Si han pasado más de 5 minutos o no tiene snapshots, guardamos
    return this.prisma.locationSnapshot.create({
      data: {
        driverId,
        latitud,
        longitud,
        evento: LOCATION_EVENTS.INTERVAL_5_MIN,
        pedidoId: pedidoId || null,
      },
    });
  }

  async getLatestDriverLocations() {
    // Busca el último snapshot de cada chofer activo para mostrar en la torre de control
    const drivers = await this.prisma.driverProfile.findMany({
      include: {
        usuario: { select: { nombre: true, email: true } },
      },
    });

    const locations = [];
    for (const driver of drivers) {
      const lastLoc = await this.prisma.locationSnapshot.findFirst({
        where: { driverId: driver.id },
        orderBy: { createdAt: 'desc' },
      });
      if (lastLoc) {
        locations.push({
          driverId: driver.id,
          nombre: driver.usuario.nombre,
          unidad: driver.unidad,
          telefono: driver.telefono,
          latitud: lastLoc.latitud,
          longitud: lastLoc.longitud,
          evento: lastLoc.evento,
          updatedAt: lastLoc.createdAt,
        });
      }
    }
    return locations;
  }
}
