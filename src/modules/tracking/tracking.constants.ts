export const TRACKING_ROOMS = {
  OPERATOR_LIVE: 'operator:live',
} as const;

export const TRACKING_EVENTS = {
  LOCATION_UPDATE: 'location:update',
  DRIVER_LOCATION: 'driver:location',
} as const;

export const LOCATION_EVENTS = {
  INTERVAL_30_SEC: '30_SEC_INTERVAL',
  INTERVAL_5_MIN: '5_MIN_INTERVAL',
} as const;
