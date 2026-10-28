# Google Maps MCP

A read-only stdio MCP server that identifies Google Maps locations and computes actual Google
routes. It exposes exactly two tools:

- `resolve_location` returns up to five Place ID, coordinate, and address candidates.
- `get_route` computes a route between two identified endpoints.

The server does not expose route matrices, waypoint optimization, nearby search, reviews,
ratings, photos, opening hours, business-detail discovery, or any write operation.

## Prerequisites

- Node.js 22 LTS
- pnpm 12.9.1 (pinned by the repository)
- A Google Cloud project with billing enabled
- Routes API, Places API (New), and Geocoding API enabled
- A server-side Google Maps Platform API key restricted to those three APIs

Google Maps Platform calls can incur charges. Start with low per-API quotas, configure Cloud
Billing budget alerts, and review current Google pricing before a live call.

## Google Cloud and key security

1. Create or select a Google Cloud project and attach a billing account.
2. Enable **Routes API**, **Places API (New)**, and **Geocoding API**.
3. Create a key intended for server-side web-service use.
4. Apply API restrictions so the key can call only those three APIs.
5. Where the server has a stable egress IP and the selected credential type supports it, apply a
   compatible IP restriction as well.
6. Set conservative API quotas and Cloud Billing budget alerts.
7. Supply the key only through the local process environment or a deployment secret manager.

Residential and other dynamic egress IPs make IP allowlisting impractical. API restrictions and
quotas reduce exposure but do not make a leaked key safe; rotate a key immediately if it may have
leaked. Never put a real key in this repository, a shell history entry, an MCP prompt, or a client
configuration that is synced insecurely.

## Install, verify, and run

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @mymcp/google-maps test
pnpm --filter @mymcp/google-maps typecheck
pnpm --filter @mymcp/google-maps build
GOOGLE_MAPS_API_KEY=REPLACE_WITH_PRIVATE_KEY pnpm --filter @mymcp/google-maps start
```

Run all repository checks with:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

From `apps/google-maps` after the workspace has been installed:

```bash
pnpm test
pnpm typecheck
pnpm build
GOOGLE_MAPS_API_KEY=REPLACE_WITH_PRIVATE_KEY pnpm start
```

The startup process deliberately fails with a nonzero status if `GOOGLE_MAPS_API_KEY` is absent.
The process does not automatically load `.env`; configure the environment in the launching MCP
client or shell. stdout is reserved for MCP JSON-RPC, while operational logs go to stderr.

## Cloudflare Worker deployment

The package also exposes a stateless Streamable HTTP endpoint for ChatGPT at
`https://mcp-route.mangagaki.net/mcp`. Cloudflare configuration lives in `wrangler.jsonc` and
binds that hostname as a Worker Custom Domain.

Set the Google key through Wrangler's interactive secret prompt so it is not written to the
repository or shell history, then deploy:

```bash
pnpm --filter @mymcp/google-maps exec wrangler secret put GOOGLE_MAPS_API_KEY
pnpm --filter @mymcp/google-maps run deploy
```

Verify `https://mcp-route.mangagaki.net/healthz`, then use MCP Inspector against the `/mcp`
endpoint. The Worker applies an account-level Cloudflare rate-limit binding before MCP dispatch;
Google Cloud quotas and billing alerts remain required. The current endpoint does not implement
end-user OAuth, so do not publish it as a broadly discoverable public plugin without adding
authentication and per-user authorization.

## Environment variables

| Variable                           | Required | Default | Accepted values / purpose                                      |
| ---------------------------------- | -------- | ------- | -------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY`              | Yes      | —       | Non-empty private API key, at most 512 characters              |
| `GOOGLE_MAPS_HTTP_TIMEOUT_MS`      | No       | `8000`  | Integer from 100 through 8000                                  |
| `GOOGLE_MAPS_MAX_RETRIES`          | No       | `2`     | Integer from 0 through 2; transient failures only              |
| `GOOGLE_MAPS_CALLS_PER_MINUTE`     | No       | `30`    | Integer from 1 through 300 across all three Google APIs        |
| `GOOGLE_MAPS_MAX_CONCURRENT_CALLS` | No       | `2`     | Integer 1 or 2                                                 |
| `LOG_LEVEL`                        | No       | `info`  | `debug`, `info`, `warn`, or `error`; logs never contain inputs |
| `GOOGLE_MAPS_LIVE_TESTS`           | No       | `0`     | Set to `1` only as an explicit human smoke-test opt-in marker  |

Every tool call makes one upstream request unless an eligible transient error is retried. The
server does not prefetch, fan out, cache Google-derived location/route content, or silently call
place search from `get_route`.

## MCP client configuration

Client configuration paths and secret-storage features differ. The following common
`mcpServers` shape is only an illustration; use the client's supported environment-secret
mechanism when one exists.

macOS/Linux example (replace both placeholders):

```json
{
  "mcpServers": {
    "google-maps": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/mymcp/apps/google-maps/dist/index.js"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "REPLACE_WITH_PRIVATE_KEY"
      }
    }
  }
}
```

Windows example:

```json
{
  "mcpServers": {
    "google-maps": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\absolute\\path\\to\\mymcp\\apps\\google-maps\\dist\\index.js"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "REPLACE_WITH_PRIVATE_KEY"
      }
    }
  }
}
```

Use absolute executable and script paths because an MCP client may launch the process from an
unrelated working directory. Restart or reload the client after changing its configuration.

## Tool workflow

### 1. Resolve names before routing

Use `query_type: "place"` for a POI, station, landmark, or business name. This calls Places API
(New) Text Search with a small field mask. `location_bias`, when supplied, is a soft hint rather
than a geographic restriction.

```json
{
  "query": "東京駅",
  "query_type": "place",
  "language_code": "ko",
  "region_code": "jp"
}
```

Use `query_type: "address"` only for a structured street address or plus code. This calls
Geocoding API v3. A location bias is rejected for address queries, and `partial_match: true`
requires user confirmation.

If `needs_disambiguation` is true, present all returned candidates and ask the user which one is
intended. Do not silently select the first result. A Place coordinate can represent a centroid;
it is not a guaranteed entrance, station gate, platform, or pickup point.

### 2. Route between identified endpoints

After selecting candidates, pass Place IDs to `get_route`. Confirmed coordinates and confirmed
postal addresses are also supported. An arbitrary place name is not a confirmed address and must
be resolved first.

```json
{
  "origin": { "type": "place_id", "place_id": "SELECTED_ORIGIN_PLACE_ID" },
  "destination": {
    "type": "place_id",
    "place_id": "SELECTED_DESTINATION_PLACE_ID"
  },
  "mode": "TRANSIT",
  "departure_time": "2027-02-27T09:30:00+09:00",
  "alternatives": true,
  "include_steps": true,
  "include_polyline": false,
  "language_code": "ko",
  "region_code": "jp"
}
```

Supported modes are `TRANSIT`, `WALK`, `DRIVE`, and `BICYCLE`. Timestamps must be RFC3339 and
include `Z` or a numeric UTC offset. `arrival_time` is transit-only and cannot be combined with
`departure_time`. Explicit departure times are supported only for transit and driving. Transit
times are locally validated against Google's documented window of seven days before through 100
days after the current time; Google remains authoritative.

`alternatives: true` requests alternatives but does not guarantee more than one route.
`traffic_aware: true` is valid only for driving. Transit preferences are valid only for transit.
Steps default to included; encoded overview polylines default to excluded.

Typical requests include Tokyo Station to Shinjuku Station by transit, Machida Station to Narita
Airport by transit, and two nearby identified points by walking. Resolve each named endpoint
separately and confirm ambiguous candidates before routing.

## Results, errors, and caveats

Known empty searches return `status: "no_results"`; unavailable routes return
`status: "no_route"`. Both are normal results. Failures use this stable shape and set the MCP
error flag:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Helpful non-secret message",
    "retryable": false,
    "upstream_status": null
  }
}
```

Possible codes are `INVALID_ARGUMENT`, `CONFIG_MISSING`, `UPSTREAM_PERMISSION_DENIED`,
`UPSTREAM_QUOTA_EXCEEDED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_BAD_RESPONSE`,
`TIMEOUT`, and `INTERNAL_ERROR`.

All returned location and route content is derived from Google and carries `Google Maps`
attribution. A downstream UI must follow current Google Maps Platform attribution, logo,
third-party attribution, and data-use requirements; this MCP process cannot enforce UI
compliance. Place IDs have distinct storage rules, but that does not authorize persistent storage
of addresses, coordinates, geometry, or route details.

Transit coverage, schedules, fares, and route availability vary. A missing fare remains `null`.
Walking and bicycling routes may be beta, incomplete, or unsafe; provider warnings are preserved
and must not be presented as a safety guarantee. Route leg coordinates can be snapped to the
nearest routable road or station. No result is an optimized itinerary or a guaranteed timetable.

## Manual live smoke test

Default tests use mocked synthetic data and never need a key. A live check can cost money and must
be performed by a human only after the APIs, billing, restrictions, quotas, and budget alerts are
configured.

1. Export the private key without writing it to a tracked file, and set
   `GOOGLE_MAPS_LIVE_TESTS=1` to record explicit opt-in in that shell/client environment.
2. Build and connect the stdio server using the client configuration above.
3. Call `resolve_location` for `東京駅` with region `jp`.
4. Call `resolve_location` separately for `新宿駅`; inspect the candidate names and addresses and
   explicitly select both intended Place IDs.
5. Call `get_route` between those IDs with `mode: "TRANSIT"`; inspect duration, walking legs,
   transit lines, transfer stops, and whether fare is absent rather than invented.
6. Resolve two nearby places and call `get_route` with `mode: "WALK"`; verify warnings are kept.
7. Repeat with `alternatives: true`; one route is a valid response if Google supplies only one.
8. Inspect client output and stderr to confirm the key never appears, then unset both environment
   variables.

Do not assert a fixed time, distance, fare, platform, or number of alternatives in a live check;
those values change. Automated CI never performs this procedure.

Official references: [Routes API](https://developers.google.com/maps/documentation/routes),
[Places API (New)](https://developers.google.com/maps/documentation/places/web-service),
[Geocoding API](https://developers.google.com/maps/documentation/geocoding), and
[Google Maps Platform policies](https://developers.google.com/maps/documentation/places/web-service/policies).
