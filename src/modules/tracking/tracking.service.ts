import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LOCATION_EVENTS } from './tracking.constants';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSnapshot(
    driverId: string,
    latitude: number,
    longitude: number,
    event?: string,
    routeAssignmentId?: string,
  ) {
    if (event && event !== LOCATION_EVENTS.INTERVAL_30_SEC) {
      return this.prisma.locationSnapshot.create({
        data: {
          driverId,
          latitude,
          longitude,
          event,
          routeAssignmentId: routeAssignmentId || null,
        },
      });
    }

    const lastSnapshot = await this.prisma.locationSnapshot.findFirst({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastSnapshot) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (lastSnapshot.createdAt > fiveMinutesAgo) {
        return null;
      }
    }

    return this.prisma.locationSnapshot.create({
      data: {
        driverId,
        latitude,
        longitude,
        event: LOCATION_EVENTS.INTERVAL_5_MIN,
        routeAssignmentId: routeAssignmentId || null,
      },
    });
  }

  async getLatestDriverLocations() {
    const drivers = await this.prisma.driverProfile.findMany({
      include: {
        user: { select: { name: true, email: true } },
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
          name: driver.user.name,
          unit: driver.unit,
          phone: driver.phone,
          latitude: lastLoc.latitude,
          longitude: lastLoc.longitude,
          event: lastLoc.event,
          updatedAt: lastLoc.createdAt,
        });
      }
    }
    return locations;
  }
}
