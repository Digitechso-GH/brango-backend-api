import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const TIMEZONE = 'America/Lima';

/**
 * Retorna el inicio y fin del día para una fecha específica en la zona horaria de Lima (UTC-5).
 * Si no se proporciona una fecha, utiliza la fecha actual.
 * @param dateStr Opcional. Fecha en formato ISO o string.
 * @returns { startOfDay: Date, endOfDay: Date }
 */
export function getLimaDayRange(dateStr?: string | Date) {
  const target = dateStr ? dayjs(dateStr).tz(TIMEZONE) : dayjs().tz(TIMEZONE);
  return {
    startOfDay: target.startOf('day').toDate(),
    endOfDay: target.endOf('day').toDate(),
  };
}

/**
 * Retorna la instancia de dayjs configurada en la zona horaria de Lima.
 */
export function getLimaDayjs(dateStr?: string | Date) {
  return dateStr ? dayjs(dateStr).tz(TIMEZONE) : dayjs().tz(TIMEZONE);
}
