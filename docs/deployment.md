# Deployment and release strategy

Phase 1 does not publish or deploy production services. CI validates the monorepo only.

## Independent releases

Treat every MCP app as a separate release unit:

1. Run the full root validation suite on Node.js 22.
2. Determine the changed app and any changed workspace dependencies.
3. Increment only affected package versions using semantic versioning.
4. Build the dependency chain and package from generated `dist/` output.
5. Publish to the selected private/public registry or assemble that app's deployment artifact.
6. Deploy and roll back that app independently of unrelated MCPs.

The root package must never be published. A future release workflow should be package-filtered,
require an explicit version/tag, use registry provenance where supported, and keep publishing
separate from pull-request CI. No publication credentials are needed in the current workflow.

Stdio apps are normally distributed as Node.js packages or immutable artifacts and launched by an
MCP client. A future Streamable HTTP app should have its own container/service definition, health
checks, authentication and authorization policy, network controls, and scaling plan.

## Configuration and secrets

- Document every environment variable in the owning app's README.
- Commit `.env.example` only when needed and use placeholders, never working values.
- Supply production secrets at runtime through the deployment platform's secret store.
- Scope credentials to one app and least privilege; do not share a monorepo-wide credential.
- Rotate secrets independently and ensure logs redact secret-bearing fields.
- Do not place tokens in MCP tool output, build arguments, images, lockfiles, or CI logs.

Environment validation should fail early with a clear stderr message that names the missing key but
does not print its value.
