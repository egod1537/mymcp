import { describe, expect, it, vi } from 'vitest';

import type { GoogleHttpClient } from '../src/clients/google-http.js';
import {
  buildComputeRoutesBody,
  buildRouteFieldMask,
  mapWaypoint,
  normalizeRoutesResponse,
  RoutesClient,
} from '../src/clients/routes.js';
import { parseGoogleDuration } from '../src/lib/duration.js';
import { getRouteInputSchema } from '../src/schemas/route.js';
import { GoogleRouteGetter } from '../src/tools/get-route.js';
import transitFixture from './fixtures/route-transit.json' with { type: 'json' };

function mockHttp(): GoogleHttpClient & {
  postJson: ReturnType<typeof vi.fn<GoogleHttpClient['postJson']>>;
  getJson: ReturnType<typeof vi.fn<GoogleHttpClient['getJson']>>;
} {
  return {
    postJson: vi.fn<GoogleHttpClient['postJson']>(),
    getJson: vi.fn<GoogleHttpClient['getJson']>(),
  };
}

const rawBase = {
  origin: { type: 'place_id', place_id: 'mock-origin' },
  destination: { type: 'place_id', place_id: 'mock-destination' },
  mode: 'TRANSIT',
} as const;

describe('get_route request construction', () => {
  it('maps each strict waypoint representation to the Google contract', () => {
    expect(mapWaypoint({ type: 'place_id', place_id: 'mock-place' })).toEqual({
      placeId: 'mock-place',
    });
    expect(mapWaypoint({ type: 'coordinates', latitude: 35, longitude: 139 })).toEqual({
      location: { latLng: { latitude: 35, longitude: 139 } },
    });
    expect(mapWaypoint({ type: 'address', address: 'Synthetic postal address' })).toEqual({
      address: 'Synthetic postal address',
    });
  });

  it('maps transit times, preferences, alternatives, and language without global routingPreference', () => {
    const input = getRouteInputSchema.parse({
      ...rawBase,
      departure_time: '2027-02-27T09:30:00+09:00',
      alternatives: true,
      transit_preference: 'FEWER_TRANSFERS',
      transit_modes: ['SUBWAY', 'TRAIN'],
      language_code: 'ja',
      region_code: 'jp',
    });

    expect(buildComputeRoutesBody(input)).toEqual({
      origin: { placeId: 'mock-origin' },
      destination: { placeId: 'mock-destination' },
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: true,
      languageCode: 'ja',
      regionCode: 'jp',
      departureTime: '2027-02-27T09:30:00+09:00',
      transitPreferences: {
        routingPreference: 'FEWER_TRANSFERS',
        allowedTravelModes: ['SUBWAY', 'TRAIN'],
      },
    });
  });

  it('uses TRAFFIC_AWARE only for DRIVE when explicitly requested', () => {
    const input = getRouteInputSchema.parse({
      ...rawBase,
      mode: 'DRIVE',
      traffic_aware: true,
    });
    expect(buildComputeRoutesBody(input)).toMatchObject({
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    });
  });

  it('derives a deterministic minimal field mask from output options', () => {
    const compact = getRouteInputSchema.parse({
      ...rawBase,
      mode: 'WALK',
      include_steps: false,
    });
    const detailedTransit = getRouteInputSchema.parse({
      ...rawBase,
      include_polyline: true,
    });
    const compactMask = buildRouteFieldMask(compact);
    const transitMask = buildRouteFieldMask(detailedTransit);

    expect(compactMask).toContain('routes.distanceMeters');
    expect(compactMask).not.toContain('steps');
    expect(compactMask).not.toContain('polyline');
    expect(transitMask).toContain('routes.legs.steps.transitDetails.stopDetails');
    expect(transitMask).toContain('routes.travelAdvisory.transitFare');
    expect(transitMask).toContain('routes.polyline.encodedPolyline');
    expect(transitMask).not.toContain('*');
  });

  it('requests the polyline settings only when include_polyline is true', () => {
    const without = buildComputeRoutesBody(getRouteInputSchema.parse(rawBase));
    const withPolyline = buildComputeRoutesBody(
      getRouteInputSchema.parse({ ...rawBase, include_polyline: true }),
    );
    expect(without).not.toHaveProperty('polylineQuality');
    expect(withPolyline).toMatchObject({
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
    });
  });
});

describe('get_route validation', () => {
  it.each([
    {
      ...rawBase,
      departure_time: '2027-02-27T09:30:00+09:00',
      arrival_time: '2027-02-27T10:30:00+09:00',
    },
    { ...rawBase, mode: 'DRIVE', arrival_time: '2027-02-27T10:30:00+09:00' },
    { ...rawBase, mode: 'DRIVE', transit_preference: 'LESS_WALKING' },
    { ...rawBase, mode: 'WALK', traffic_aware: true },
    { ...rawBase, mode: 'BICYCLE', departure_time: '2027-02-27T09:30:00+09:00' },
    { ...rawBase, departure_time: '2027-02-27T09:30:00' },
    {
      ...rawBase,
      origin: { type: 'place_id', place_id: 'x', address: 'mixed representation' },
    },
  ])('rejects an invalid mode/time/waypoint combination before network access', async (input) => {
    const http = mockHttp();
    const getter = new GoogleRouteGetter(new RoutesClient(http), {
      now: () => Date.parse('2027-02-20T00:00:00Z'),
    });

    await expect(getter.getRoute(input)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(http.postJson).not.toHaveBeenCalled();
  });

  it('enforces the transit schedule window relative to an injected clock', async () => {
    const http = mockHttp();
    const getter = new GoogleRouteGetter(new RoutesClient(http), {
      now: () => Date.parse('2027-02-20T00:00:00Z'),
    });

    await expect(
      getter.getRoute({ ...rawBase, departure_time: '2027-06-15T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(http.postJson).not.toHaveBeenCalled();
  });
});

describe('get_route response normalization', () => {
  it('preserves route order, warnings, transit details, and a genuinely missing fare', async () => {
    const http = mockHttp();
    http.postJson.mockResolvedValue(transitFixture);
    const getter = new GoogleRouteGetter(new RoutesClient(http), {
      now: () => Date.parse('2027-02-20T00:00:00Z'),
    });

    const result = await getter.getRoute({
      ...rawBase,
      departure_time: '2027-02-27T09:30:00+09:00',
      alternatives: true,
    });

    expect(result.status).toBe('ok');
    expect(result.routes.map((route) => route.description)).toEqual([
      'Synthetic transit route',
      'Synthetic alternate route',
    ]);
    expect(result.routes[0]).toMatchObject({
      duration_seconds: 2420,
      warnings: ['Synthetic provider warning'],
      fare: null,
    });
    expect(result.routes[0]?.legs[0]?.steps?.[0]).toMatchObject({
      duration_seconds: 3.5,
      transit: {
        departure_stop: { name: 'Mock Origin Stop', latitude: 35.11, longitude: 139.11 },
        arrival_stop: {
          name: 'Mock Destination Stop',
          latitude: 35.19,
          longitude: 139.19,
        },
        line_name: 'Mock Rail Line',
        line_short_name: 'MR',
        headsign: 'Mock Terminus',
        vehicle_type: 'RAIL',
        departure_local_time: '09:30',
        arrival_local_time: '10:10',
        departure_time_zone: 'Asia/Tokyo',
        arrival_time_zone: 'Asia/Tokyo',
        time_zone: 'Asia/Tokyo',
      },
    });
    expect(result.fallback_info).toEqual({
      routing_mode: 'TRAFFIC_UNAWARE',
      reason: 'SERVER_ERROR',
    });
  });

  it('returns no_route as a normal result', async () => {
    const http = mockHttp();
    http.postJson.mockResolvedValue({ routes: [] });
    const getter = new GoogleRouteGetter(new RoutesClient(http));

    const result = await getter.getRoute({ ...rawBase, mode: 'WALK' });

    expect(result.status).toBe('no_route');
    expect(result.routes).toEqual([]);
  });

  it('omits steps from normalized legs when not requested', () => {
    const normalized = normalizeRoutesResponse(transitFixture, false);
    expect(normalized.routes[0]?.legs[0]).not.toHaveProperty('steps');
  });

  it('parses protobuf durations and rejects malformed values', () => {
    expect(parseGoogleDuration('2420s')).toBe(2420);
    expect(parseGoogleDuration('3.5s')).toBe(3.5);
    expect(parseGoogleDuration(undefined)).toBeNull();
    expect(() => parseGoogleDuration('')).toThrowError(/malformed route duration/i);
    expect(() => parseGoogleDuration('tomorrow')).toThrowError(/malformed route duration/i);
  });
});
