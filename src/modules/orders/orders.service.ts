import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { EstadoPedido, GeocodingStatus } from '@prisma/client';
import { REQUIRED_ORDER_FIELDS } from './orders.constants';
import * as XLSX from 'xlsx';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto, creatorId: string) {
    const existing = await this.prisma.pedido.findUnique({
      where: { codigo: dto.codigo },
    });
    if (existing) {
      throw new BadRequestException(
        `El código de pedido ${dto.codigo} ya existe`,
      );
    }

    const client = await this.prisma.cliente.findUnique({
      where: { id: dto.clienteId },
    });
    if (!client) {
      throw new BadRequestException(
        `El cliente con ID ${dto.clienteId} no existe`,
      );
    }

    if (dto.driverId) {
      const driver = await this.prisma.driverProfile.findUnique({
        where: { id: dto.driverId },
      });
      if (!driver) {
        throw new BadRequestException(
          `El chofer con ID ${dto.driverId} no existe`,
        );
      }
    }

    let finalCreatorId = creatorId;
    const creatorExists = await this.prisma.usuario.findUnique({
      where: { id: creatorId },
    });
    if (!creatorExists) {
      const firstUser = await this.prisma.usuario.findFirst();
      if (firstUser) {
        finalCreatorId = firstUser.id;
      } else {
        throw new BadRequestException(
          'No hay ningún usuario registrado para asociar la auditoría del pedido',
        );
      }
    }

    const { lat, lng } = this.resolveGeocoding(dto.latitud, dto.longitud);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.pedido.create({
        data: {
          codigo: dto.codigo,
          guia: dto.guia || null,
          documentoDestinatario: dto.documentoDestinatario,
          direccionOriginal: dto.direccionOriginal,
          latitud: lat,
          longitud: lng,
          geocodingStatus: GeocodingStatus.VALIDATED,
          clienteId: dto.clienteId,
          driverId: dto.driverId || null,
        },
      });

      await tx.orderTimeline.create({
        data: {
          pedidoId: order.id,
          estadoNuevo: EstadoPedido.PENDING,
          userId: finalCreatorId,
        },
      });

      return order;
    });
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.pedido.findUnique({
      where: { id },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.pedido.update({
        where: { id },
        data: { estado: dto.estado },
      });

      await tx.orderTimeline.create({
        data: {
          pedidoId: id,
          estadoAnterior: order.estado,
          estadoNuevo: dto.estado,
          userId: dto.userId,
        },
      });

      return updatedOrder;
    });
  }

  async findAll() {
    return this.prisma.pedido.findMany({
      include: {
        cliente: { include: { empresa: true } },
        chofer: { include: { usuario: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.pedido.findUnique({
      where: { id },
      include: {
        cliente: { include: { empresa: true } },
        chofer: { include: { usuario: true } },
        orderTimelines: {
          include: { usuario: true },
          orderBy: { createdAt: 'desc' },
        },
        evidencias: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }
    return order;
  }

  async importExcel(fileBuffer: Buffer, operatorId: string) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException(
        'El archivo Excel está vacío o no contiene hojas',
      );
    }

    const worksheet = workbook.Sheets[sheetName];
    // Convertir a JSON filas crudas
    const rawRows = XLSX.utils.sheet_to_json<any>(worksheet);
    if (rawRows.length === 0) {
      throw new BadRequestException(
        'El archivo Excel no contiene filas de datos',
      );
    }

    let finalOperatorId = operatorId;
    const operatorExists = await this.prisma.usuario.findUnique({
      where: { id: operatorId },
    });
    if (!operatorExists) {
      const firstUser = await this.prisma.usuario.findFirst();
      if (firstUser) {
        finalOperatorId = firstUser.id;
      } else {
        throw new BadRequestException(
          'No hay ningún usuario registrado para registrar auditoría de la importación',
        );
      }
    }

    const errors: Array<{ row: number; error: string }> = [];
    const seenCodes = new Set<string>();
    const ordersToCreate: any[] = [];

    // Cargar clientes existentes en memoria para validar más rápido
    const clients = await this.prisma.cliente.findMany();
    const clientIds = new Set(clients.map((c) => c.id));

    // Cargar códigos existentes en DB para validar
    const existingOrders = await this.prisma.pedido.findMany({
      select: { codigo: true },
    });
    const existingCodesInDb = new Set(existingOrders.map((o) => o.codigo));

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 2; // Fila física Excel (asumiendo cabecera en fila 1)
      const row = rawRows[i];

      // 1. Validar campos requeridos centralizados
      const missingFields: string[] = [];
      for (const field of REQUIRED_ORDER_FIELDS) {
        // En Excel la direccionOriginal a veces la llaman "direccion"
        const value =
          field === 'direccionOriginal'
            ? row.direccionOriginal || row.direccion
            : row[field];
        if (
          value === undefined ||
          value === null ||
          String(value).trim() === ''
        ) {
          missingFields.push(field);
        }
      }

      if (missingFields.length > 0) {
        errors.push({
          row: rowNum,
          error: `Faltan campos obligatorios: ${missingFields.join(', ')}`,
        });
        continue;
      }

      const codigo = String(row.codigo).trim();
      const clientUuid = String(row.clienteId).trim();
      const direccion = String(row.direccionOriginal || row.direccion).trim();
      const documento = String(row.documentoDestinatario).trim();
      const guia = row.guia ? String(row.guia).trim() : null;

      // 2. Validar duplicados en el mismo archivo
      if (seenCodes.has(codigo)) {
        errors.push({
          row: rowNum,
          error: `El código de pedido "${codigo}" está duplicado dentro del archivo Excel`,
        });
        continue;
      }
      seenCodes.add(codigo);

      // 3. Validar duplicados contra la DB
      if (existingCodesInDb.has(codigo)) {
        errors.push({
          row: rowNum,
          error: `El código de pedido "${codigo}" ya está registrado en el sistema`,
        });
        continue;
      }

      // 4. Validar existencia del cliente
      if (!clientIds.has(clientUuid)) {
        errors.push({
          row: rowNum,
          error: `El cliente con ID "${clientUuid}" no existe en el sistema`,
        });
        continue;
      }

      const latValue = row.latitud ? parseFloat(row.latitud) : undefined;
      const lngValue = row.longitud ? parseFloat(row.longitud) : undefined;
      const { lat, lng } = this.resolveGeocoding(latValue, lngValue);

      ordersToCreate.push({
        codigo,
        guia,
        documentoDestinatario: documento,
        direccionOriginal: direccion,
        latitud: lat,
        longitud: lng,
        geocodingStatus: GeocodingStatus.VALIDATED,
        clienteId: clientUuid,
      });
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'ERR_VALIDATION_FAILED',
        details: errors,
      });
    }

    // 5. Inserción atómica en base de datos
    return this.prisma.$transaction(async (tx) => {
      const createdOrders = [];
      for (const orderData of ordersToCreate) {
        const order = await tx.pedido.create({
          data: orderData,
        });

        await tx.orderTimeline.create({
          data: {
            pedidoId: order.id,
            estadoNuevo: EstadoPedido.PENDING,
            userId: finalOperatorId,
          },
        });

        createdOrders.push(order);
      }
      return createdOrders;
    });
  }

  private resolveGeocoding(latInput?: number, lngInput?: number) {
    let lat = latInput;
    let lng = lngInput;

    if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) {
      // Centro de Lima: -12.046374, -77.042793
      // Desplazamiento aleatorio controlado entre -0.05 y +0.05
      const offsetLat = (Math.random() - 0.5) * 0.1;
      const offsetLng = (Math.random() - 0.5) * 0.1;
      lat = -12.046374 + offsetLat;
      lng = -77.042793 + offsetLng;
    }

    return { lat, lng };
  }
}
