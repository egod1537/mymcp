import * as z from "zod/v4";
import { TRAVEL_MODES } from "../google-routes/types.js";

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

export class GoogleRoutesApiError extends Error {
  override readonly name: string = "GoogleRoutesApiError";

  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly apiStatus?: string,
  ) {
    super(message);
  }
}

export class TimeoutError extends Error {
  override readonly name = "TimeoutError";
}

export class RateLimitError extends GoogleRoutesApiError {
  override readonly name = "RateLimitError";
}

export class UnsupportedRouteError extends Error {
  override readonly name = "UnsupportedRouteError";
}

export const routeLocationSchema = z.union([
  z.strictObject({ address: z.string().trim().min(1).max(500).describe("A human-readable address or place name") }),
  z.strictObject({
    lat: z.number().finite().min(-90).max(90).describe("Latitude in decimal degrees"),
    lng: z.number().finite().min(-180).max(180).describe("Longitude in decimal degrees"),
  }),
  z.strictObject({ placeId: z.string().trim().min(1).max(500).describe("A Google Maps place ID") }),
]).describe("A route location specified by address, coordinates, or Google place ID");

export const travelModeSchema = z.enum(TRAVEL_MODES);

const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isValidRfc3339(value: string): boolean {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const offset = match[7]!;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > lastDay) return false;

  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  return Number.isFinite(Date.parse(value));
}

export const departureTimeSchema = z.string().refine(isValidRfc3339, {
  message: "departureTime must be a valid RFC3339 timestamp, for example 2026-10-10T10:00:00+09:00.",
}).describe("RFC3339 departure timestamp including a timezone offset");

export const computeRouteInputSchema = z.strictObject({
  origin: routeLocationSchema,
  destination: routeLocationSchema,
  travelMode: travelModeSchema.optional().describe("Defaults to DRIVE"),
  departureTime: departureTimeSchema.optional(),
  computeAlternativeRoutes: z.boolean().optional().describe("Request alternate routes when Google supports them"),
  languageCode: z.string().trim().min(2).max(35).optional().describe("BCP-47 language code such as en or ko"),
  units: z.enum(["METRIC", "IMPERIAL"]).optional(),
});

export const computeRouteMatrixInputSchema = z.strictObject({
  origins: z.array(routeLocationSchema).min(1).max(100),
  destinations: z.array(routeLocationSchema).min(1).max(100),
  travelMode: travelModeSchema.optional().describe("Defaults to DRIVE"),
  departureTime: departureTimeSchema.optional(),
});

export const compareTravelModesInputSchema = z.strictObject({
  origin: routeLocationSchema,
  destination: routeLocationSchema,
  travelModes: z.array(travelModeSchema).min(1).max(5).optional().describe("Defaults to DRIVE, TRANSIT, and WALK; maximum five"),
  departureTime: departureTimeSchema.optional(),
});

export const getTravelTimeInputSchema = z.strictObject({
  origin: routeLocationSchema,
  destination: routeLocationSchema,
  travelMode: travelModeSchema.optional().describe("Defaults to DRIVE"),
  departureTime: departureTimeSchema.optional(),
});

const coordinatesOutputSchema = z.strictObject({
  lat: z.number(),
  lng: z.number(),
});

const routeLegOutputSchema = z.strictObject({
  distanceMeters: z.number().optional(),
  durationSeconds: z.number().optional(),
  startLocation: coordinatesOutputSchema.optional(),
  endLocation: coordinatesOutputSchema.optional(),
});

const routeOutputSchema = z.strictObject({
  distanceMeters: z.number().optional(),
  durationSeconds: z.number().optional(),
  staticDurationSeconds: z.number().optional(),
  polyline: z.string().optional(),
  description: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  legs: z.array(routeLegOutputSchema).optional(),
});

export const computeRouteOutputSchema = z.strictObject({
  routes: z.array(routeOutputSchema),
});

export const routeMatrixOutputSchema = z.strictObject({
  originsCount: z.number().int().nonnegative(),
  destinationsCount: z.number().int().nonnegative(),
  elements: z.array(z.strictObject({
    originIndex: z.number().int().nonnegative(),
    destinationIndex: z.number().int().nonnegative(),
    distanceMeters: z.number().optional(),
    durationSeconds: z.number().optional(),
    condition: z.string().optional(),
    status: z.strictObject({
      code: z.number().optional(),
      message: z.string().optional(),
    }).optional(),
  })),
  durationsSeconds: z.array(z.array(z.number().nullable())),
});

export const compareTravelModesOutputSchema = z.strictObject({
  results: z.array(z.strictObject({
    travelMode: travelModeSchema,
    available: z.boolean(),
    distanceMeters: z.number().optional(),
    durationSeconds: z.number().optional(),
    error: z.string().optional(),
  })),
});

export const travelTimeOutputSchema = z.strictObject({
  distanceMeters: z.number().optional(),
  durationSeconds: z.number().optional(),
  durationMinutes: z.number().optional(),
});

export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return Number(value);
}

export function validateMatrixSize(
  originsCount: number,
  destinationsCount: number,
  maximumElements: number,
): number {
  const elements = originsCount * destinationsCount;
  if (elements > maximumElements) {
    throw new ValidationError(
      `Route matrix request is too large: ${elements} elements requested, maximum is ${maximumElements}.`,
    );
  }
  return elements;
}

export function validateWaypointFieldCount(locations: Array<{ address: string } | { lat: number; lng: number } | { placeId: string }>): void {
  const addressOrPlaceIdCount = locations.filter(
    (location) => "address" in location || "placeId" in location,
  ).length;
  if (addressOrPlaceIdCount > 50) {
    throw new ValidationError(
      `Route matrix has ${addressOrPlaceIdCount} address/place ID waypoints; Google allows at most 50 across origins and destinations.`,
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
