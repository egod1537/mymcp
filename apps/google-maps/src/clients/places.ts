import { GoogleMapsError } from '../lib/errors.js';
import {
  isRecord,
  optionalFiniteNumber,
  optionalString,
  requireRecord,
} from '../lib/normalization.js';
import type { LocationCandidate, ResolveLocationInput } from '../schemas/location.js';
import type { GoogleHttpClient } from './google-http.js';

const placesFieldMask = 'places.id,places.displayName,places.formattedAddress,places.location';

export interface PlacesSearchInput {
  query: string;
  languageCode: string;
  regionCode?: string;
  locationBias?: ResolveLocationInput['location_bias'];
}

export class PlacesClient {
  constructor(private readonly http: GoogleHttpClient) {}

  async searchText(input: PlacesSearchInput): Promise<LocationCandidate[]> {
    const body = {
      textQuery: input.query,
      pageSize: 5,
      languageCode: input.languageCode,
      ...(input.regionCode === undefined ? {} : { regionCode: input.regionCode }),
      ...(input.locationBias === undefined
        ? {}
        : {
            locationBias: {
              circle: {
                center: {
                  latitude: input.locationBias.latitude,
                  longitude: input.locationBias.longitude,
                },
                radius: input.locationBias.radius_meters,
              },
            },
          }),
    };

    const response = await this.http.postJson('placesTextSearch', {
      headers: { 'X-Goog-FieldMask': placesFieldMask },
      body,
    });
    return normalizePlacesResponse(response);
  }
}

export function normalizePlacesResponse(response: unknown): LocationCandidate[] {
  const root = requireRecord(response, 'Places');
  if (root.error !== undefined) {
    throw new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google Places returned an unexpected error payload.',
    );
  }
  if (root.places === undefined) {
    return [];
  }
  if (!Array.isArray(root.places)) {
    throw new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google returned malformed Places candidates.',
    );
  }

  return root.places
    .flatMap((place): LocationCandidate[] => {
      if (!isRecord(place)) {
        return [];
      }
      const placeId = optionalString(place.id);
      const location = isRecord(place.location) ? place.location : undefined;
      const latitude = optionalFiniteNumber(location?.latitude);
      const longitude = optionalFiniteNumber(location?.longitude);
      if (placeId === null || latitude === null || longitude === null) {
        return [];
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return [];
      }

      const displayName = isRecord(place.displayName)
        ? optionalString(place.displayName.text)
        : null;
      return [
        {
          place_id: placeId,
          display_name: displayName,
          formatted_address: optionalString(place.formattedAddress),
          latitude,
          longitude,
          precision: null,
          partial_match: false,
        },
      ];
    })
    .slice(0, 5);
}

export { placesFieldMask };
