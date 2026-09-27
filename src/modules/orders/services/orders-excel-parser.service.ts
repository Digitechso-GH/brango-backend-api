
function parseExcelDueDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    const year = val.getUTCFullYear();
    const month = val.getUTCMonth();
    const day = val.getUTCDate();
    return dayjs().tz(TIMEZONE).year(year).month(month).date(day).endOf('day').toDate();
  }
  const str = String(val).trim();
  if (!str) return null;
  // Match DD/MM/YYYY or DD-MM-YYYY (with optional HH:mm)
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    const year = parseInt(dmy[3], 10);
    if (dmy[4]) {
      const hour = parseInt(dmy[4], 10);
      const min = parseInt(dmy[5] || '0', 10);
      return dayjs().tz(TIMEZONE).year(year).month(month).date(day).hour(hour).minute(min).second(59).millisecond(0).toDate();
    }
    return dayjs().tz(TIMEZONE).year(year).month(month).date(day).endOf('day').toDate();
  }
  const parsed = dayjs(str).tz(TIMEZONE);
  if (parsed.isValid()) {
    return parsed.endOf('day').toDate();
  }
  return null;
}

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocodingService } from './geocoding.service';
import { RecipientCustomerType } from '@prisma/client';
import dayjs from 'dayjs';
import { getLimaDayjs, TIMEZONE } from '../../../core/utils/date.util';
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
  dueDate?: Date | null;
}

@Injectable()
export class OrdersExcelParserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocodingService: GeocodingService,
  ) {}

    async parseAndValidateExcelBuffer(buffer: Buffer): Promise<ParsedExcelRow[]> {
    const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rawMatrix: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (!rawMatrix || rawMatrix.length <= 1) {
      throw new BadRequestException('El archivo Excel está vacío o sólo contiene encabezados');
    }

    const dataRows = rawMatrix.slice(1);
    const headerRow = (rawMatrix[0] || []).map((h: any) => String(h || '').trim());

    // 1. Detección dinámica de columnas por encabezados (soporta FECHA VENC. como Columna A / 0)
    let dueDateColIdx = headerRow.findIndex((h: string) => /venc|fecha.*venc|due.*date|plazo/i.test(h));
    let codeColIdx = headerRow.findIndex((h: string) => /^(n[ºo°]?\s*)?pedido|c[oó]digo/i.test(h));
    let waybillColIdx = headerRow.findIndex((h: string) => /gu[ií]a|remisi[oó]n|waybill/i.test(h));
    let nameColIdx = headerRow.findIndex((h: string) => /cliente|nombre|raz[oó]n/i.test(h));
    let addressColIdx = headerRow.findIndex((h: string) => /^direcci[oó]n/i.test(h));
    let linkColIdx = headerRow.findIndex((h: string) => /link|url|maps/i.test(h));
    let phoneColIdx = headerRow.findIndex((h: string) => /contacto.*cliente|tel[eé]fono|celular/i.test(h));
    let warehouseContactColIdx = headerRow.findIndex((h: string) => /contacto.*almac[eé]n|almac[eé]n/i.test(h));

    // Si la Columna A (índice 0) es FECHA VENC. o el pedido está en la columna B (índice 1)
    const isFirstColDueDate = dueDateColIdx === 0 || (dueDateColIdx === -1 && codeColIdx === 1);

    // Fallbacks posicionales exactos
    if (codeColIdx < 0) codeColIdx = isFirstColDueDate ? 1 : 0;
    if (dueDateColIdx < 0 && isFirstColDueDate) dueDateColIdx = 0;
    if (waybillColIdx < 0) waybillColIdx = isFirstColDueDate ? 2 : 1;
    if (nameColIdx < 0) nameColIdx = isFirstColDueDate ? 3 : 2;
    if (addressColIdx < 0) addressColIdx = isFirstColDueDate ? 4 : 3;
    if (linkColIdx < 0) linkColIdx = isFirstColDueDate ? 5 : 4;
    if (phoneColIdx < 0) phoneColIdx = isFirstColDueDate ? 6 : 5;
    if (warehouseContactColIdx < 0) warehouseContactColIdx = isFirstColDueDate ? 8 : 7;

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

      const code = String(row[codeColIdx] || '').trim();
      const waybill = waybillColIdx >= 0 ? String(row[waybillColIdx] || '').trim() : '';
      const nameCol = nameColIdx >= 0 ? String(row[nameColIdx] || '').trim() : '';
      const address = addressColIdx >= 0 ? String(row[addressColIdx] || '').trim() : '';
      const link = linkColIdx >= 0 ? String(row[linkColIdx] || '').trim() : '';
      const phone = phoneColIdx >= 0 ? String(row[phoneColIdx] || '').trim() : '';
      const warehouseContact = warehouseContactColIdx >= 0 ? String(row[warehouseContactColIdx] || '').trim() : '';

      const rawDueDate = dueDateColIdx >= 0 ? row[dueDateColIdx] : null;
      const parsedDueDate = parseExcelDueDate(rawDueDate);

      // El enlace de Google Maps es estrictamente obligatorio (Sin fallbacks)
      const targetAddress = link;

      if (!code) {
        errors.push({ fila: rowNum, error: 'Falta el Nº de pedido' });
      } else if (seenCodigosInFile.has(code)) {
        errors.push({ fila: rowNum, error: `El Nº de pedido "${code}" se encuentra duplicado en el archivo` });
      } else {
        seenCodigosInFile.add(code);
      }

      if (!targetAddress) {
        errors.push({ fila: rowNum, error: 'Es estrictamente obligatorio proveer el enlace de Google Maps en la columna LINK' });
      }

      if (!nameCol) {
        errors.push({ fila: rowNum, error: 'Falta nombre del cliente/destinatario' });
      }

      if (phone && warehouseContact) {
        const phoneDigits = phone.replace(/\D/g, '');
        const warehouseDigits = warehouseContact.replace(/\D/g, '');
        if (phoneDigits && warehouseDigits && phoneDigits === warehouseDigits) {
          errors.push({ fila: rowNum, error: 'El contacto comercial no puede ser igual al contacto del cliente' });
        }
      }

      if (targetAddress) {
        addressesToGeocodeSet.add(targetAddress);
      }

      const isEmpresa =
        /s\. ?a\. ?c\.?|s\. ?a\.?|e\. ?i\. ?r\. ?l\.?|s\. ?r\. ?l\.?|s\. ?a\. ?a\.?/i.test(nameCol) ||
        nameCol.toUpperCase().includes('GRUPO') ||
        nameCol.toUpperCase().includes('S.A.');

      rawParsedRows.push({
        rowNumber: rowNum,
        code,
        waybill: waybill || null,
        recipientCustomerType: isEmpresa ? RecipientCustomerType.COMPANY : RecipientCustomerType.INDIVIDUAL,
        recipientDocument: '',
        recipientName: isEmpresa ? null : nameCol,
        companyName: isEmpresa ? nameCol : null,
        companyRuc: null,
        recipientPhone: phone || null,
        rawAddress: targetAddress,
        formattedAddress: address || targetAddress,
        warehouseContact: warehouseContact || null,
        dueDate: parsedDueDate,
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

    const finalMappedRows = rawParsedRows.map((item) => {
      const geo = geocodeCacheMap.get(item.rawAddress) || { lat: null, lng: null, status: 'FAILED' };
      return {
        ...item,
        latitude: geo.lat,
        longitude: geo.lng,
        geocodingStatus: geo.status || 'FAILED',
        dueDate: item.dueDate || null,
      };
    });

    const geocodingErrors = finalMappedRows.filter(row => row.geocodingStatus === 'FAILED' || !row.latitude);
    if (geocodingErrors.length > 0) {
      for (const errRow of geocodingErrors) {
        errors.push({
          fila: errRow.rowNumber,
          error: `No se pudo obtener la latitud/longitud de este enlace de Google Maps. Por favor, revise que el enlace sea válido.`
        });
      }
      throw new BadRequestException({
        message: 'El archivo Excel contiene enlaces de Google Maps inválidos',
        errors,
      });
    }

    return finalMappedRows;
  }
}
