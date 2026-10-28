import { describe, expect, it, vi } from 'vitest';

import { GeocodingClient, normalizeGeocodingResponse } from '../src/clients/geocoding.js';
import type { GoogleHttpClient } from '../src/clients/google-http.js';
import { PlacesClient, normalizePlacesResponse, placesFieldMask } from '../src/clients/places.js';
import { GoogleMapsError } from '../src/lib/errors.js';
import { GoogleLocationResolver } from '../src/tools/resolve-location.js';
import geocodingFixture from './fixtures/geocoding.json' with { type: 'json' };
import placesFixture from './fixtures/places.json' with { type: 'json' };

function mockHttp(): GoogleHttpClient & {
  postJson: ReturnType<typeof vi.fn<GoogleHttpClient['postJson']>>;
  getJson: ReturnType<typeof vi.fn<GoogleHttpClient['getJson']>>;
} {
  return {
    postJson: vi.fn<GoogleHttpClient['postJson']>(),
    getJson: vi.fn<GoogleHttpClient['getJson']>(),
  };
}

describe('resolve_location', () => {
  it.each(['서울역', 'Tokyo Station', '東京駅'])(
    'forwards the Unicode place query unchanged: %s',
    async (query) => {
      const http = mockHttp();
      http.postJson.mockResolvedValue({ places: [] });
      const resolver = new GoogleLocationResolver(
        new PlacesClient(http),
        new GeocodingClient(http),
      );

      const result = await resolver.resolve({ query });

      expect(result.status).toBe('no_results');
      expect(http.postJson).toHaveBeenCalledWith(
        'placesTextSearch',
        expect.objectContaining({
          body: expect.objectContaining({ textQuery: query, languageCode: 'ko', pageSize: 5 }),
        }),
      );
    },
  );

  it('uses an economical Places field mask and maps a soft location bias', async () => {
    const http = mockHttp();
    http.postJson.mockResolvedValue({ places: [] });
    const places = new PlacesClient(http);

    await places.searchText({
      query: 'station',
      languageCode: 'en',
      regionCode: 'jp',
      locationBias: { latitude: 35, longitude: 139, radius_meters: 5000 },
    });

    expect(placesFieldMask).toBe(
      'places.id,places.displayName,places.formattedAddress,places.location',
    );
    expect(placesFieldMask).not.toMatch(/\*|review|price/i);
    expect(http.postJson).toHaveBeenCalledWith('placesTextSearch', {
      headers: { 'X-Goog-FieldMask': placesFieldMask },
      body: {
        textQuery: 'station',
        pageSize: 5,
        languageCode: 'en',
        regionCode: 'jp',
        locationBias: {
          circle: { center: { latitude: 35, longitude: 139 }, radius: 5000 },
        },
      },
    });
  });

  it('returns every valid candidate and marks multiple results for disambiguation', async () => {
    const http = mockHttp();
    http.postJson.mockResolvedValue(placesFixture);
    const resolver = new GoogleLocationResolver(new PlacesClient(http), new GeocodingClient(http));

    const result = await resolver.resolve({ query: 'mock place', region_code: 'jp' });

    expect(result.status).toBe('ok');
    expect(result.candidates.map((candidate) => candidate.place_id)).toEqual([
      'mock-place-alpha',
      'mock-place-beta',
    ]);
    expect(result.needs_disambiguation).toBe(true);
  });

  it('marks a single partial geocoding match for disambiguation', async () => {
    const http = mockHttp();
    http.getJson.mockResolvedValue(geocodingFixture);
    const resolver = new GoogleLocationResolver(new PlacesClient(http), new GeocodingClient(http));

    const result = await resolver.resolve({ query: 'synthetic address', query_type: 'address' });

    expect(result.source).toBe('google_geocoding');
    expect(result.candidates[0]).toMatchObject({
      place_id: 'mock-geocode-alpha',
      precision: 'RANGE_INTERPOLATED',
      partial_match: true,
    });
    expect(result.needs_disambiguation).toBe(true);
    expect(http.getJson).toHaveBeenCalledWith('geocoding', {
      query: { address: 'synthetic address', language: 'ko' },
      retryOnJsonStatuses: ['UNKNOWN_ERROR'],
    });
  });

  it.each([
    { query: '' },
    { query: 'x'.repeat(251) },
    { query: 'x', location_bias: { latitude: 91, longitude: 0, radius_meters: 1 } },
    { query: 'x', location_bias: { latitude: 0, longitude: 0, radius_meters: 50001 } },
    {
      query: 'address',
      query_type: 'address',
      location_bias: { latitude: 0, longitude: 0, radius_meters: 10 },
    },
  ])('rejects invalid input before any network call', async (input) => {
    const http = mockHttp();
    const resolver = new GoogleLocationResolver(new PlacesClient(http), new GeocodingClient(http));

    await expect(resolver.resolve(input)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(http.postJson).not.toHaveBeenCalled();
    expect(http.getJson).not.toHaveBeenCalled();
  });

  it('omits malformed candidates without inventing IDs or coordinates', () => {
    expect(
      normalizePlacesResponse({
        places: [
          { id: 'missing-coordinate' },
          { location: { latitude: 1, longitude: 2 } },
          { id: 'valid', location: { latitude: 1, longitude: 2 } },
        ],
      }),
    ).toEqual([
      {
        place_id: 'valid',
        display_name: null,
        formatted_address: null,
        latitude: 1,
        longitude: 2,
        precision: null,
        partial_match: false,
      },
    ]);
  });

  it.each([
    ['ZERO_RESULTS', undefined, undefined],
    ['REQUEST_DENIED', 'UPSTREAM_PERMISSION_DENIED', 'REQUEST_DENIED'],
    ['OVER_QUERY_LIMIT', 'UPSTREAM_QUOTA_EXCEEDED', 'OVER_QUERY_LIMIT'],
    ['UNKNOWN_ERROR', 'UPSTREAM_UNAVAILABLE', 'UNKNOWN_ERROR'],
  ])('maps Geocoding body status %s', (status, code, upstreamStatus) => {
    if (status === 'ZERO_RESULTS') {
      expect(normalizeGeocodingResponse({ status })).toEqual([]);
      return;
    }
    try {
      normalizeGeocodingResponse({ status });
      throw new Error('expected normalizer to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleMapsError);
      expect(error).toMatchObject({ code, upstreamStatus });
    }
  });
});
