import { GoogleMapsError } from '../lib/errors.js';
import { parseGoogleDuration } from '../lib/duration.js';
import {
  getPath,
  isRecord,
  optionalFiniteNumber,
  optionalString,
  requireRecord,
  stringArray,
  type UnknownRecord,
} from '../lib/normalization.js';
import type {
  Coordinate,
  FallbackInfo,
  GetRouteInput,
  NormalizedRoute,
  RouteFare,
  RouteLeg,
  RouteStep,
  TransitStep,
  TransitStop,
  Waypoint,
} from '../schemas/route.js';
import type { GoogleHttpClient } from './google-http.js';

const baseFields = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.description',
  'routes.routeLabels',
  'routes.warnings',
  'routes.legs.startLocation',
  'routes.legs.endLocation',
  'fallbackInfo',
];

const stepFields = [
  'routes.legs.steps.travelMode',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.navigationInstruction.instructions',
  'routes.legs.steps.startLocation',
  'routes.legs.steps.endLocation',
];

const transitStepFields = [
  'routes.legs.steps.transitDetails.stopDetails',
  'routes.legs.steps.transitDetails.localizedValues',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.headsign',
  'routes.legs.steps.transitDetails.stopCount',
];

const transitSummaryFields = [
  'routes.travelAdvisory.transitFare',
  'routes.localizedValues.transitFare',
];

export function buildRouteFieldMask(input: GetRouteInput): string {
  const fields = [...baseFields];
  if (input.include_steps) {
    fields.push(...stepFields);
    if (input.mode === 'TRANSIT') {
      fields.push(...transitStepFields);
    }
  }
  if (input.mode === 'TRANSIT') {
    fields.push(...transitSummaryFields);
  }
  if (input.include_polyline) {
    fields.push('routes.polyline.encodedPolyline');
  }
  return fields.join(',');
}

export function mapWaypoint(waypoint: Waypoint): UnknownRecord {
  switch (waypoint.type) {
    case 'place_id':
      return { placeId: waypoint.place_id };
    case 'coordinates':
      return {
        location: {
          latLng: {
            latitude: waypoint.latitude,
            longitude: waypoint.longitude,
          },
        },
      };
    case 'address':
      return { address: waypoint.address };
  }
}

export function buildComputeRoutesBody(input: GetRouteInput): UnknownRecord {
  const transitPreferences =
    input.mode === 'TRANSIT' &&
    (input.transit_preference !== undefined || input.transit_modes !== undefined)
      ? {
          ...(input.transit_preference === undefined
            ? {}
            : { routingPreference: input.transit_preference }),
          ...(input.transit_modes === undefined ? {} : { allowedTravelModes: input.transit_modes }),
        }
      : undefined;

  return {
    origin: mapWaypoint(input.origin),
    destination: mapWaypoint(input.destination),
    travelMode: input.mode,
    computeAlternativeRoutes: input.alternatives,
    languageCode: input.language_code,
    ...(input.region_code === undefined ? {} : { regionCode: input.region_code }),
    ...(input.departure_time === undefined ? {} : { departureTime: input.departure_time }),
    ...(input.arrival_time === undefined ? {} : { arrivalTime: input.arrival_time }),
    ...(transitPreferences === undefined ? {} : { transitPreferences }),
    ...(input.mode === 'DRIVE' && input.traffic_aware
      ? { routingPreference: 'TRAFFIC_AWARE' }
      : {}),
    ...(input.include_polyline
      ? {
          polylineQuality: 'OVERVIEW',
          polylineEncoding: 'ENCODED_POLYLINE',
        }
      : {}),
  };
}

export interface NormalizedRoutesResponse {
  routes: NormalizedRoute[];
  fallbackInfo: FallbackInfo | null;
}

export class RoutesClient {
  constructor(private readonly http: GoogleHttpClient) {}

  async compute(input: GetRouteInput): Promise<NormalizedRoutesResponse> {
    const response = await this.http.postJson('computeRoutes', {
      headers: { 'X-Goog-FieldMask': buildRouteFieldMask(input) },
      body: buildComputeRoutesBody(input),
    });
    return normalizeRoutesResponse(response, input.include_steps);
  }
}

function nonNegativeNumber(value: unknown, context: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new GoogleMapsError('UPSTREAM_BAD_RESPONSE', `Google returned malformed ${context}.`);
  }
  return value;
}

function coordinate(value: unknown): Coordinate | null {
  if (value === undefined || value === null) {
    return null;
  }
  const latitude = optionalFiniteNumber(getPath(value, 'latLng', 'latitude'));
  const longitude = optionalFiniteNumber(getPath(value, 'latLng', 'longitude'));
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function transitStop(value: unknown): TransitStop {
  const location = coordinate(getPath(value, 'location'));
  return {
    name: optionalString(getPath(value, 'name')),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  };
}

function localizedTime(value: unknown): string | null {
  return optionalString(getPath(value, 'time', 'text')) ?? optionalString(getPath(value, 'text'));
}

function transitDetails(value: unknown): TransitStep | null {
  if (!isRecord(value)) {
    return null;
  }
  const departureLocalized = getPath(value, 'localizedValues', 'departureTime');
  const arrivalLocalized = getPath(value, 'localizedValues', 'arrivalTime');
  const departureTimeZone = optionalString(getPath(departureLocalized, 'timeZone'));
  const arrivalTimeZone = optionalString(getPath(arrivalLocalized, 'timeZone'));
  return {
    departure_stop: transitStop(getPath(value, 'stopDetails', 'departureStop')),
    arrival_stop: transitStop(getPath(value, 'stopDetails', 'arrivalStop')),
    departure_time: optionalString(getPath(value, 'stopDetails', 'departureTime')),
    arrival_time: optionalString(getPath(value, 'stopDetails', 'arrivalTime')),
    line_name: optionalString(getPath(value, 'transitLine', 'name')),
    line_short_name: optionalString(getPath(value, 'transitLine', 'nameShort')),
    headsign: optionalString(value.headsign),
    vehicle_type: optionalString(getPath(value, 'transitLine', 'vehicle', 'type')),
    stop_count: nonNegativeNumber(value.stopCount, 'transit stop count'),
    departure_local_time: localizedTime(departureLocalized),
    arrival_local_time: localizedTime(arrivalLocalized),
    departure_time_zone: departureTimeZone,
    arrival_time_zone: arrivalTimeZone,
    time_zone:
      departureTimeZone !== null && departureTimeZone === arrivalTimeZone
        ? departureTimeZone
        : null,
  };
}

function normalizeStep(value: unknown): RouteStep {
  const step = requireRecord(value, 'route step');
  return {
    mode: optionalString(step.travelMode),
    distance_meters: nonNegativeNumber(step.distanceMeters, 'step distance'),
    duration_seconds: parseGoogleDuration(step.staticDuration),
    instruction: optionalString(getPath(step, 'navigationInstruction', 'instructions')),
    start_location: coordinate(step.startLocation),
    end_location: coordinate(step.endLocation),
    transit: transitDetails(step.transitDetails),
  };
}

function normalizeLeg(value: unknown, includeSteps: boolean): RouteLeg {
  const leg = requireRecord(value, 'route leg');
  const normalized: RouteLeg = {
    start_location: coordinate(leg.startLocation),
    end_location: coordinate(leg.endLocation),
  };
  if (includeSteps) {
    if (leg.steps !== undefined && !Array.isArray(leg.steps)) {
      throw new GoogleMapsError('UPSTREAM_BAD_RESPONSE', 'Google returned malformed route steps.');
    }
    normalized.steps = (leg.steps ?? []).map(normalizeStep);
  }
  return normalized;
}

function moneyNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(converted) ? converted : null;
}

function normalizeFare(route: UnknownRecord): RouteFare | null {
  const money = getPath(route, 'travelAdvisory', 'transitFare');
  const localized = getPath(route, 'localizedValues', 'transitFare');
  if (!isRecord(money) && !isRecord(localized)) {
    return null;
  }
  return {
    currency_code:
      optionalString(getPath(money, 'currencyCode')) ??
      optionalString(getPath(localized, 'currencyCode')),
    units: moneyNumber(getPath(money, 'units')),
    nanos: moneyNumber(getPath(money, 'nanos')),
    text:
      optionalString(getPath(localized, 'text')) ??
      optionalString(getPath(localized, 'localizedText')),
  };
}

function normalizeRoute(value: unknown, index: number, includeSteps: boolean): NormalizedRoute {
  const route = requireRecord(value, 'route');
  if (route.legs !== undefined && !Array.isArray(route.legs)) {
    throw new GoogleMapsError('UPSTREAM_BAD_RESPONSE', 'Google returned malformed route legs.');
  }
  return {
    index,
    duration_seconds: parseGoogleDuration(route.duration),
    distance_meters: nonNegativeNumber(route.distanceMeters, 'route distance'),
    description: optionalString(route.description),
    labels: stringArray(route.routeLabels),
    warnings: stringArray(route.warnings),
    overview_polyline: optionalString(getPath(route, 'polyline', 'encodedPolyline')),
    fare: normalizeFare(route),
    legs: (route.legs ?? []).map((leg) => normalizeLeg(leg, includeSteps)),
  };
}

function normalizeFallback(value: unknown): FallbackInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    routing_mode: optionalString(value.routingMode),
    reason: optionalString(value.reason),
  };
}

export function normalizeRoutesResponse(
  response: unknown,
  includeSteps: boolean,
): NormalizedRoutesResponse {
  const root = requireRecord(response, 'Routes');
  if (root.error !== undefined) {
    throw new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google Routes returned an unexpected error payload.',
    );
  }
  if (root.routes !== undefined && !Array.isArray(root.routes)) {
    throw new GoogleMapsError('UPSTREAM_BAD_RESPONSE', 'Google returned malformed routes.');
  }
  return {
    routes: (root.routes ?? []).map((route, index) => normalizeRoute(route, index, includeSteps)),
    fallbackInfo: normalizeFallback(root.fallbackInfo),
  };
}
