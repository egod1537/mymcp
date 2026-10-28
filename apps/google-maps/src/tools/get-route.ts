import type { Clock } from '../clients/google-http.js';
import type { RoutesClient } from '../clients/routes.js';
import { GoogleMapsError, invalidArgument } from '../lib/errors.js';
import { getRouteInputSchema, type GetRouteInput, type GetRouteResult } from '../schemas/route.js';

const dayMilliseconds = 24 * 60 * 60 * 1_000;
const systemClock: Clock = { now: () => Date.now() };

export interface RouteGetter {
  getRoute(input: unknown): Promise<GetRouteResult>;
}

export class GoogleRouteGetter implements RouteGetter {
  constructor(
    private readonly routesClient: RoutesClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async getRoute(rawInput: unknown): Promise<GetRouteResult> {
    const parsed = getRouteInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw invalidArgument(parsed.error);
    }
    this.validateTransitWindow(parsed.data);
    const response = await this.routesClient.compute(parsed.data);
    return {
      status: response.routes.length === 0 ? 'no_route' : 'ok',
      mode: parsed.data.mode,
      origin: parsed.data.origin,
      destination: parsed.data.destination,
      requested_departure_time: parsed.data.departure_time ?? null,
      requested_arrival_time: parsed.data.arrival_time ?? null,
      routes: response.routes,
      fallback_info: response.fallbackInfo,
      attribution: 'Google Maps',
    };
  }

  private validateTransitWindow(input: GetRouteInput): void {
    if (input.mode !== 'TRANSIT') {
      return;
    }
    const timestamp = input.departure_time ?? input.arrival_time;
    if (timestamp === undefined) {
      return;
    }
    const requested = Date.parse(timestamp);
    const now = this.clock.now();
    const earliest = now - 7 * dayMilliseconds;
    const latest = now + 100 * dayMilliseconds;
    if (requested < earliest || requested > latest) {
      throw new GoogleMapsError(
        'INVALID_ARGUMENT',
        `TRANSIT time must be between ${new Date(earliest).toISOString()} and ${new Date(latest).toISOString()}.`,
      );
    }
  }
}
