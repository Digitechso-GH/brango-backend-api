import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocodingService } from './geocoding.service';
import { RecipientCustomerType } from '@prisma/client';
import * as xlsx from 'xlsx';

export interface ParsedExcelRow {
  rowNumber: number;
  code: string;
  waybill?: string | null;
  recipientCustomerType: RecipientCustomerType;
  recipientDocument: string;
  recipientName?: string | null;
  companyName?: string | null;
  companyRuc?: string | null;
  recipientPhone?: string | null;
  rawAddress: string;
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
  geocodingStatus: string;
  warehouseContact?: string | null;
}

@Injectable()
export class OrdersExcelParserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocodingService: GeocodingService,
  ) {}

  async parseAndValidateExcelBuffer(buffer: Buffer): Promise<ParsedExcelRow[]> {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rawMatrix: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rawMatrix || rawMatrix.length <= 1) {
      throw new BadRequestException('El archivo Excel está vacío o sólo contiene encabezados');
    }

    const dataRows = rawMatrix.slice(1);
    const errors: Array<{ fila: number; error: string }> = [];
    const seenCodigosInFile = new Set<string>();
    const addressesToGeocodeSet = new Set<string>();
    const rawParsedRows: ParsedExcelRow[] = [];

    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index] || [];
      const rowNum = index + 2;

      if (!row.some((val: any) => val !== undefined && val !== null && String(val).trim() !== '')) {
        continue;
      }

      const code = String(row[0] || '').trim();
      const nameCol = String(row[1] || '').trim();
      const address = String(row[2] || '').trim();
      const link = String(row[3] || '').trim();
      const phone = String(row[4] || '').trim();
      const warehouseContact = String(row[6] || '').trim();

      const targetAddress = address || link;

      if (!code) {
        errors.push({ fila: rowNum, error: 'Falta el Nº de pedido' });
      } else if (seenCodigosInFile.has(code)) {
        errors.push({ fila: rowNum, error: `El Nº de pedido "${code}" se encuentra duplicado en el archivo` });
      } else {
        seenCodigosInFile.add(code);
      }

      if (!targetAddress) {
        errors.push({ fila: rowNum, error: 'Falta la dirección de destino o enlace de Maps' });
      }

      if (!nameCol) {
        errors.push({ fila: rowNum, error: 'Falta nombre del cliente/destinatario' });
      }

      if (targetAddress) {
        addressesToGeocodeSet.add(targetAddress);
      }

      const isEmpresa =
        /s\.?a\.?c\.?|s\.?a\.?|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?a\.?/i.test(nameCol) ||
        nameCol.toUpperCase().includes('GRUPO') ||
        nameCol.toUpperCase().includes('S.A.');

      rawParsedRows.push({
        rowNumber: rowNum,
        code,
        waybill: null,
        recipientCustomerType: isEmpresa ? RecipientCustomerType.COMPANY : RecipientCustomerType.INDIVIDUAL,
        recipientDocument: '',
        recipientName: isEmpresa ? null : nameCol,
        companyName: isEmpresa ? nameCol : null,
        companyRuc: null,
        recipientPhone: phone || null,
        rawAddress: targetAddress,
        formattedAddress: address || targetAddress,
        warehouseContact: warehouseContact || null,
        latitude: null,
        longitude: null,
        geocodingStatus: 'FAILED',
      });
    }

    if (seenCodigosInFile.size > 0) {
      const existingInDb = await this.prisma.order.findMany({
        where: { code: { in: Array.from(seenCodigosInFile) } },
        select: { code: true },
      });

      if (existingInDb.length > 0) {
        for (const existingOrder of existingInDb) {
          const matchingRow = rawParsedRows.find((r) => r.code === existingOrder.code);
          errors.push({
            fila: matchingRow ? matchingRow.rowNumber : 0,
            error: `El Nº de pedido "${existingOrder.code}" ya se encuentra registrado en el sistema`,
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'El archivo Excel contiene errores de validación',
        errors,
      });
    }

    const geocodeCacheMap = await this.geocodingService.resolveBulkGeocoding(
      Array.from(addressesToGeocodeSet),
    );

    return rawParsedRows.map((item) => {
      const geo = geocodeCacheMap.get(item.rawAddress) || { lat: null, lng: null, status: 'FAILED' };
      return {
        ...item,
        latitude: geo.lat,
        longitude: geo.lng,
        geocodingStatus: geo.status || 'FAILED',
      };
    });
  }
}
