import { z } from 'zod';

const languageCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'language_code must be a BCP-47 language tag.');

const regionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'region_code must contain exactly two letters.');

const timestampSchema = z
  .string()
  .trim()
  .max(64)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    'Timestamp must be RFC3339 and include Z or a numeric UTC offset.',
  )
  .refine((value) => Number.isFinite(Date.parse(value)), 'Timestamp is not a valid date-time.');

export const waypointSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('place_id'),
      place_id: z.string().trim().min(1).max(512).describe('Confirmed Google Place ID'),
    })
    .strict(),
  z
    .object({
      type: z.literal('coordinates'),
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal('address'),
      address: z.string().trim().min(1).max(250).describe('Confirmed postal or street address'),
    })
    .strict(),
]);

export const getRouteInputSchema = z
  .object({
    origin: waypointSchema.describe('Identified route origin'),
    destination: waypointSchema.describe('Identified route destination'),
    mode: z.enum(['TRANSIT', 'WALK', 'DRIVE', 'BICYCLE']).describe('Required travel mode'),
    departure_time: timestampSchema.optional(),
    arrival_time: timestampSchema.optional(),
    alternatives: z.boolean().default(false),
    transit_preference: z.enum(['LESS_WALKING', 'FEWER_TRANSFERS']).optional(),
    transit_modes: z
      .array(z.enum(['BUS', 'SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL']))
      .min(1)
      .max(5)
      .optional(),
    traffic_aware: z.boolean().default(false),
    include_steps: z.boolean().default(true),
    include_polyline: z.boolean().default(false),
    language_code: languageCodeSchema.default('ko'),
    region_code: regionCodeSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.departure_time && input.arrival_time) {
      context.addIssue({
        code: 'custom',
        path: ['arrival_time'],
        message: 'departure_time and arrival_time are mutually exclusive.',
      });
    }
    if (input.arrival_time && input.mode !== 'TRANSIT') {
      context.addIssue({
        code: 'custom',
        path: ['arrival_time'],
        message: 'arrival_time is supported only for TRANSIT.',
      });
    }
    if (input.departure_time && input.mode !== 'TRANSIT' && input.mode !== 'DRIVE') {
      context.addIssue({
        code: 'custom',
        path: ['departure_time'],
        message: 'departure_time is supported only for TRANSIT and DRIVE.',
      });
    }
    if (
      input.mode !== 'TRANSIT' &&
      (input.transit_preference !== undefined || input.transit_modes !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transit_preference'],
        message: 'Transit preferences are supported only for TRANSIT.',
      });
    }
    if (input.mode !== 'DRIVE' && input.traffic_aware) {
      context.addIssue({
        code: 'custom',
        path: ['traffic_aware'],
        message: 'traffic_aware may be true only for DRIVE.',
      });
    }
  });

export type Waypoint = z.infer<typeof waypointSchema>;
export type GetRouteInput = z.infer<typeof getRouteInputSchema>;

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface TransitStop {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface TransitStep {
  departure_stop: TransitStop;
  arrival_stop: TransitStop;
  departure_time: string | null;
  arrival_time: string | null;
  line_name: string | null;
  line_short_name: string | null;
  headsign: string | null;
  vehicle_type: string | null;
  stop_count: number | null;
  departure_local_time: string | null;
  arrival_local_time: string | null;
  departure_time_zone: string | null;
  arrival_time_zone: string | null;
  time_zone: string | null;
}

export interface RouteStep {
  mode: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  instruction: string | null;
  start_location: Coordinate | null;
  end_location: Coordinate | null;
  transit: TransitStep | null;
}

export interface RouteLeg {
  start_location: Coordinate | null;
  end_location: Coordinate | null;
  steps?: RouteStep[];
}

export interface RouteFare {
  currency_code: string | null;
  units: number | null;
  nanos: number | null;
  text: string | null;
}

export interface NormalizedRoute {
  index: number;
  duration_seconds: number | null;
  distance_meters: number | null;
  description: string | null;
  labels: string[];
  warnings: string[];
  overview_polyline: string | null;
  fare: RouteFare | null;
  legs: RouteLeg[];
}

export interface FallbackInfo {
  routing_mode: string | null;
  reason: string | null;
}

export interface GetRouteResult {
  status: 'ok' | 'no_route';
  mode: GetRouteInput['mode'];
  origin: Waypoint;
  destination: Waypoint;
  requested_departure_time: string | null;
  requested_arrival_time: string | null;
  routes: NormalizedRoute[];
  fallback_info: FallbackInfo | null;
  attribution: 'Google Maps';
}
