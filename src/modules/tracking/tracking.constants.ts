export const TRACKING_ROOMS = {
  DRIVERS: 'drivers',
  OPERATORS: 'operators',
} as const;

export const TRACKING_EVENTS = {
  LOCATION_UPDATE: 'location_update',
  DRIVER_LOCATION: 'driver_location',
} as const;

export const LOCATION_EVENTS = {
  INTERVAL_30_SEC: '30_SEC_INTERVAL',
  INTERVAL_5_MIN: '5_MIN_INTERVAL',
} as const;
