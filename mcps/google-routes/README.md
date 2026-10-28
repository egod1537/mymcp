# Google Routes MCP

Read-only MCP server for the Google Maps Platform Routes API. It exposes route, travel-time, travel-mode comparison, and route-matrix results as structured data.

This package is an independent MCP server in the `mymcp` pnpm workspace. It does not share a transport or tool registry with the other MCP packages.

## Google Cloud setup

1. Create or select a [Google Cloud project](https://console.cloud.google.com/).
2. Link a billing account. Google Maps Platform Routes API usage is billable.
3. Enable the [Routes API](https://console.cloud.google.com/google/maps-apis/api-list).
4. Create an API key.
5. Restrict the key to the Routes API and apply the appropriate application restrictions for the deployment environment.
6. Store the key in `GOOGLE_MAPS_API_KEY`; never commit it.

Google documentation:

- [Routes API overview](https://developers.google.com/maps/documentation/routes/overview)
- [Usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [API security best practices](https://developers.google.com/maps/api-security-best-practices)

## Installation

From the repository root:

```bash
pnpm install
cp mcps/google-routes/.env.example mcps/google-routes/.env
```

Set at least:

```env
GOOGLE_MAPS_API_KEY=your-api-key
```

Available settings:

```env
GOOGLE_MAPS_API_KEY=
GOOGLE_ROUTES_TIMEOUT_MS=10000
GOOGLE_ROUTES_MAX_CONCURRENCY=4
GOOGLE_ROUTES_MAX_MATRIX_ELEMENTS=100
GOOGLE_ROUTES_CACHE_TTL_MS=300000
LOG_LEVEL=info
```

## Development and build

From the repository root:

```bash
pnpm dev:google-routes
pnpm build:google-routes
pnpm test:google-routes
pnpm --filter @mymcp/google-routes typecheck
```

Or from this directory:

```bash
pnpm dev
pnpm build
pnpm test
```

Run the compiled stdio server:

```bash
node mcps/google-routes/dist/index.js
```

The server can start without an API key so that an MCP client can discover its tools. A tool call that needs Google returns `Missing GOOGLE_MAPS_API_KEY.`

## MCP client configuration

Build the package, then configure an MCP client with an absolute path:

```json
{
  "mcpServers": {
    "google-routes": {
      "command": "node",
      "args": ["/absolute/path/to/mymcp/mcps/google-routes/dist/index.js"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "your-api-key"
      }
    }
  }
}
```

The first transport is stdio. Google API calls are isolated in `GoogleRoutesClient`, so a Streamable HTTP entry point can be added without moving route logic into the transport.

## Tools

All tools are read-only. Locations accept one of these forms:

```json
{ "address": "Hakata Station, Fukuoka" }
```

```json
{ "lat": 33.5902, "lng": 130.4207 }
```

```json
{ "placeId": "ChIJ..." }
```

Travel modes are `DRIVE`, `TRANSIT`, `WALK`, `BICYCLE`, and `TWO_WHEELER`. `DRIVE` is the default.

### `get_travel_time`

Returns only the first route's distance and duration. Its Google response field mask requests no polyline or leg details.

Input:

```json
{
  "origin": { "address": "Seoul Station, Seoul" },
  "destination": { "address": "Gangnam Station, Seoul" },
  "travelMode": "TRANSIT",
  "departureTime": "2026-10-10T10:00:00+09:00"
}
```

Output:

```json
{
  "distanceMeters": 12000,
  "durationSeconds": 2100,
  "durationMinutes": 35
}
```

### `compute_route`

Returns route details and can request alternatives. Google can return up to the number of alternatives supported by the API for that route and mode; order is preserved.

Input:

```json
{
  "origin": { "address": "Hakata Station, Fukuoka" },
  "destination": { "address": "Fukuoka Tower, Fukuoka" },
  "travelMode": "TRANSIT",
  "computeAlternativeRoutes": true,
  "languageCode": "en",
  "units": "METRIC"
}
```

Output:

```json
{
  "routes": [
    {
      "distanceMeters": 6700,
      "durationSeconds": 1740,
      "staticDurationSeconds": 1600,
      "polyline": "encoded-polyline",
      "description": "Route description",
      "warnings": [],
      "legs": [
        {
          "distanceMeters": 6700,
          "durationSeconds": 1740,
          "startLocation": { "lat": 33.5902, "lng": 130.4207 },
          "endLocation": { "lat": 33.5933, "lng": 130.3515 }
        }
      ]
    }
  ]
}
```

### `compare_travel_modes`

Makes one Compute Routes request per unique mode, with at most five modes. The default modes are `DRIVE`, `TRANSIT`, and `WALK`. A failure for one mode is represented on that result instead of failing the entire tool.

Input:

```json
{
  "origin": { "address": "Seoul Station, Seoul" },
  "destination": { "address": "Jamsil Station, Seoul" },
  "travelModes": ["DRIVE", "TRANSIT", "WALK"]
}
```

Output:

```json
{
  "results": [
    {
      "travelMode": "DRIVE",
      "available": true,
      "distanceMeters": 15300,
      "durationSeconds": 1900
    },
    {
      "travelMode": "BICYCLE",
      "available": false,
      "error": "Google Routes API rejected the request: INVALID_ARGUMENT."
    }
  ]
}
```

### `compute_route_matrix`

Returns Google's element records without reordering them. Use `originIndex` and `destinationIndex` to map each record. It also returns `durationsSeconds`, a row-major convenience matrix whose unavailable cells are `null`.

Input:

```json
{
  "origins": [
    { "address": "Hakata Station, Fukuoka" },
    { "address": "Ohori Park, Fukuoka" }
  ],
  "destinations": [
    { "address": "Fukuoka Tower, Fukuoka" },
    { "address": "Tenjin, Fukuoka" }
  ],
  "travelMode": "TRANSIT",
  "departureTime": "2026-10-10T10:00:00+09:00"
}
```

Output:

```json
{
  "originsCount": 2,
  "destinationsCount": 2,
  "elements": [
    {
      "originIndex": 0,
      "destinationIndex": 0,
      "distanceMeters": 6200,
      "durationSeconds": 1680,
      "condition": "ROUTE_EXISTS",
      "status": {}
    }
  ],
  "durationsSeconds": [
    [1680, 900],
    [720, 840]
  ]
}
```

## Departure-time policy

`departureTime` must be an RFC3339 timestamp such as `2026-10-10T10:00:00+09:00`. The server does not silently insert the current time. When it is omitted, the request leaves the field out and uses Google's mode-specific default behavior.

For `DRIVE`, supplying `departureTime` also selects `TRAFFIC_AWARE` routing. That may change the billable Routes API SKU. Other modes send the time without choosing a driving routing preference; Google returns a clear upstream error when the mode or time is unsupported.

## Cost and request protections

- Route Matrix usage is measured in elements: `origins.length × destinations.length`.
- The server rejects requests above `GOOGLE_ROUTES_MAX_MATRIX_ELEMENTS` before an API call. The default is 100.
- Raising that setting never bypasses Google's current hard limits: 100 elements for `TRANSIT` and 625 for the other supported matrix requests used here.
- It also enforces Google's limit of 50 address/place-ID waypoints across matrix origins and destinations.
- Matrix requests are never split into hidden parallel batches.
- `compare_travel_modes` accepts at most five modes.
- Google requests have a default concurrency limit of four.
- Results are cached in memory for five minutes by default. Cache keys include location arrays in their original order, mode, departure time, alternatives, request body, and field mask.
- Each operation requests a minimal response field mask.
- Network errors, timeouts, HTTP 429, and HTTP 5xx responses are retried at most three times with 500 ms, 1 s, and 2 s delays. Other 4xx responses are not retried.

Review current Google pricing and quotas before production use. Cache contents and concurrency limits are process-local.

## Tests

Unit and fixture tests do not call Google:

```bash
pnpm --filter @mymcp/google-routes test
```

They cover location normalization, protobuf duration conversion, field masks, matrix limits, cache keys, error mapping, response fixtures, element ordering, and partial travel-mode failure.

Live tests are opt-in and incur API usage:

```bash
RUN_LIVE_TESTS=1 GOOGLE_MAPS_API_KEY=your-api-key \
  pnpm --filter @mymcp/google-routes test
```

The live suite checks:

- Seoul Station to Gangnam Station by `DRIVE`
- Seoul Station to Gangnam Station by `TRANSIT`
- a 2 × 2 Seoul route matrix
- Hakata Station to Fukuoka Tower by `TRANSIT`

## Known limitations

- Only stdio transport is included. There is no authenticated Streamable HTTP endpoint yet.
- Transit, bicycle, walking, and two-wheel routes depend on Google's regional data and mode availability. There is no scraping or unofficial-provider fallback.
- `BICYCLE` and `TWO_WHEELER` availability and warnings vary by region.
- Transit departure times are subject to Google's supported time window and schedule data.
- Encoded polylines are returned as strings and are not decoded by this package.
- The cache is lost when the process exits and is not shared between replicas.
- An address string is never assumed to be the same physical location merely because two strings match. Only identical coordinates or identical place IDs use the zero-distance shortcut.
