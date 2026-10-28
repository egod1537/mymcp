07 - README, CLIENT CONNECTION AND OPERATIONAL DOCS

DELIVER apps/google-maps/README.md WITH:
- Brief description and exact supported MCP tool names.
- Prerequisites Node 22, pnpm, Google Cloud project with billing, enabled API list.
- Security guidance on creating/restricting the API key and quota/budget controls.
- Install/build/start commands from repo root and app directory.
- Environment variables table with valid ranges and safe defaults.
- MCP client stdio configuration example using ABSOLUTE PATHS for command/args;
  env.GOOGLE_MAPS_API_KEY as a non-real placeholder; never hardcode user's key.
- A Windows client example and a macOS/Linux example if appropriate.
- Explain how to pass the key through environment variables on clients that
  support env settings; do not invent a universal ChatGPT MCP installation method.
- Explain place resolution workflow: resolve_location -> select Place ID -> get_route.
- Explain query_type='place' versus 'address'.
- Explain supported modes: TRANSIT, WALK, DRIVE, BICYCLE.
- Explain RFC3339 offset timezone requirement and transit 7d past/100d future window.
- Example use cases: Tokyo Station to Shinjuku Station by TRANSIT,
  Machida Station to Narita Airport by TRANSIT, two nearby points by WALK.
- Google data provider attribution and routes/walking/bike caveats.
- Expected error codes, no-results response and disambiguation workflow.
- Confirm no route matrix, search_nearby, reviews or business details tool.

LOCAL COMMANDS (adapt scripts to actual workspace):
  corepack enable
  pnpm install
  pnpm --filter @egod1537/google-maps-mcp build
  pnpm --filter @egod1537/google-maps-mcp start
  pnpm lint && pnpm typecheck && pnpm test && pnpm build

TYPICAL CLIENT CONFIG ILLUSTRATION (NOT A PROMISE OF ALL CLIENT COMPATIBILITY):
  {
    "mcpServers": {
      "google-maps": {
        "command": "node",
        "args": ["/absolute/path/to/mymcp/apps/google-maps/dist/index.js"],
        "env": {"GOOGLE_MAPS_API_KEY":"REPLACE_WITH_PRIVATE_KEY"}
      }
    }
  }
This JSON is example only: clients have different configuration paths and
security storage conventions. Users must keep keys out of Git.

EXPECTED CALL FLOW
  User: 'How can I travel from 東京駅 to 新宿駅 by train on a given date/time?'
  1. resolve_location({query:'東京駅', query_type:'place', region_code:'jp'})
  2. resolve_location({query:'新宿駅', query_type:'place', region_code:'jp'})
  3. Choose unambiguous results. If not clear, request a specific station/area.
  4. get_route({origin:{type:'place_id',place_id:'...'},
                destination:{type:'place_id',place_id:'...'},
                mode:'TRANSIT', departure_time:'2027-02-27T09:30:00+09:00',
                alternatives:true, include_steps:true})
  5. Report time, walking legs, transit lines and transfer stops using returned data.
Remember: mock IDs above are placeholders; never send literal '...' to Google.

OPERATIONAL EXPECTATIONS
- Startup failure is understandable if no key is set.
- CLI does not print to stdout other than MCP JSON-RPC.
- User sees what data may cost money and when live requests happen.
- Document only tested commands, file paths, and SDK APIs; no speculative setup.

Read next: 08_ACCEPTANCE_AND_HANDOFF.txt
