import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const TIMEZONE = 'America/Lima';

/**
 * Retorna la instancia de dayjs configurada en la zona horaria de Lima (America/Lima, UTC-5).
 * Si se pasa un string en formato fecha (YYYY-MM-DD o YYYY-MM-DD HH:mm:ss),
 * se parsea DIRECTAMENTE en la zona horaria de Lima usando dayjs.tz(dateInput, TIMEZONE)
 * para evitar que en servidores con reloj UTC se reste 5 horas y se atrase un día.
 */
export function getLimaDayjs(dateInput?: string | Date) {
  if (!dateInput) {
    return dayjs().tz(TIMEZONE);
  }
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) {
      return dayjs().tz(TIMEZONE);
    }
    // Si viene como fecha sola o fecha con hora sin zona (YYYY-MM-DD o YYYY-MM-DD HH:mm:ss)
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(trimmed)) {
      return dayjs.tz(trimmed, TIMEZONE);
    }
    // Si viene con offset ISO o UTC (ej: 2026-09-08T05:00:00.000Z)
    return dayjs(trimmed).tz(TIMEZONE);
  }
  return dayjs(dateInput).tz(TIMEZONE);
}

/**
 * Retorna el inicio y fin del día para una fecha específica en la zona horaria de Lima (UTC-5).
 * Si no se proporciona una fecha, utiliza la fecha actual en Lima.
 * @param dateInput Opcional. Fecha en formato ISO o string.
 * @returns { startOfDay: Date, endOfDay: Date }
 */
export function getLimaDayRange(dateInput?: string | Date) {
  const target = getLimaDayjs(dateInput);
  return {
    startOfDay: target.startOf('day').toDate(),
    endOfDay: target.endOf('day').toDate(),
  };
}
