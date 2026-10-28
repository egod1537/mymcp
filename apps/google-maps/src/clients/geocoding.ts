import { GoogleMapsError } from '../lib/errors.js';
import {
  getPath,
  isRecord,
  optionalFiniteNumber,
  optionalString,
  requireRecord,
} from '../lib/normalization.js';
import type { LocationCandidate } from '../schemas/location.js';
import type { GoogleHttpClient } from './google-http.js';

export interface GeocodingInput {
  address: string;
  languageCode: string;
  regionCode?: string;
}

export class GeocodingClient {
  constructor(private readonly http: GoogleHttpClient) {}

  async geocode(input: GeocodingInput): Promise<LocationCandidate[]> {
    const response = await this.http.getJson('geocoding', {
      query: {
        address: input.address,
        language: input.languageCode,
        ...(input.regionCode === undefined ? {} : { region: input.regionCode }),
      },
      retryOnJsonStatuses: ['UNKNOWN_ERROR'],
    });
    return normalizeGeocodingResponse(response);
  }
}

export function normalizeGeocodingResponse(response: unknown): LocationCandidate[] {
  const root = requireRecord(response, 'Geocoding');
  const status = optionalString(root.status);
  if (status === null) {
    throw new GoogleMapsError('UPSTREAM_BAD_RESPONSE', 'Google Geocoding returned no status.');
  }
  if (status === 'ZERO_RESULTS') {
    return [];
  }
  if (status === 'REQUEST_DENIED') {
    throw new GoogleMapsError(
      'UPSTREAM_PERMISSION_DENIED',
      'Google rejected Geocoding API access. Check key restrictions, billing, and API enablement.',
      { upstreamStatus: status },
    );
  }
  if (status === 'OVER_QUERY_LIMIT') {
    throw new GoogleMapsError(
      'UPSTREAM_QUOTA_EXCEEDED',
      'The Google Geocoding API quota is exhausted.',
      { upstreamStatus: status },
    );
  }
  if (status === 'INVALID_REQUEST') {
    throw new GoogleMapsError(
      'INVALID_ARGUMENT',
      'Google rejected the geocoding request arguments.',
      { upstreamStatus: status },
    );
  }
  if (status === 'UNKNOWN_ERROR') {
    throw new GoogleMapsError(
      'UPSTREAM_UNAVAILABLE',
      'Google Geocoding is temporarily unavailable.',
      { retryable: true, upstreamStatus: status },
    );
  }
  if (status !== 'OK' || !Array.isArray(root.results)) {
    throw new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google returned an unexpected Geocoding response.',
      { upstreamStatus: status },
    );
  }

  return root.results
    .flatMap((result): LocationCandidate[] => {
      if (!isRecord(result)) {
        return [];
      }
      const placeId = optionalString(result.place_id);
      const latitude = optionalFiniteNumber(getPath(result, 'geometry', 'location', 'lat'));
      const longitude = optionalFiniteNumber(getPath(result, 'geometry', 'location', 'lng'));
      if (placeId === null || latitude === null || longitude === null) {
        return [];
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return [];
      }

      const formattedAddress = optionalString(result.formatted_address);
      return [
        {
          place_id: placeId,
          display_name: null,
          formatted_address: formattedAddress,
          latitude,
          longitude,
          precision: optionalString(getPath(result, 'geometry', 'location_type')),
          partial_match: result.partial_match === true,
        },
      ];
    })
    .slice(0, 5);
}
