import { invalidArgument } from '../lib/errors.js';
import {
  resolveLocationInputSchema,
  type ResolveLocationInput,
  type ResolveLocationResult,
} from '../schemas/location.js';
import type { GeocodingClient } from '../clients/geocoding.js';
import type { PlacesClient } from '../clients/places.js';

export interface LocationResolver {
  resolve(input: unknown): Promise<ResolveLocationResult>;
}

export class GoogleLocationResolver implements LocationResolver {
  constructor(
    private readonly places: PlacesClient,
    private readonly geocoding: GeocodingClient,
  ) {}

  async resolve(rawInput: unknown): Promise<ResolveLocationResult> {
    const parsed = resolveLocationInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw invalidArgument(parsed.error);
    }
    return parsed.data.query_type === 'place'
      ? this.resolvePlace(parsed.data)
      : this.resolveAddress(parsed.data);
  }

  private async resolvePlace(input: ResolveLocationInput): Promise<ResolveLocationResult> {
    const candidates = await this.places.searchText({
      query: input.query,
      languageCode: input.language_code,
      ...(input.region_code === undefined ? {} : { regionCode: input.region_code }),
      ...(input.location_bias === undefined ? {} : { locationBias: input.location_bias }),
    });
    return {
      status: candidates.length === 0 ? 'no_results' : 'ok',
      query: input.query,
      query_type: 'place',
      source: 'google_places_text_search',
      candidates,
      needs_disambiguation: candidates.length > 1,
      attribution: 'Google Maps',
    };
  }

  private async resolveAddress(input: ResolveLocationInput): Promise<ResolveLocationResult> {
    const candidates = await this.geocoding.geocode({
      address: input.query,
      languageCode: input.language_code,
      ...(input.region_code === undefined ? {} : { regionCode: input.region_code }),
    });
    return {
      status: candidates.length === 0 ? 'no_results' : 'ok',
      query: input.query,
      query_type: 'address',
      source: 'google_geocoding',
      candidates,
      needs_disambiguation:
        candidates.length > 1 || candidates.some((candidate) => candidate.partial_match),
      attribution: 'Google Maps',
    };
  }
}
