# Security policy

Reelori is currently a local-only, single-user application. Bind the service to
`127.0.0.1`; do not expose ports 4311 or 5178 to a network or put them behind a
public reverse proxy. Hosted FlowBarAI integration will require a separate
authentication and authorization design.

Do not send API keys, raw project files, private media, or access tokens in a
public issue. If you discover a vulnerability, use the repository's private
GitHub vulnerability reporting feature once the public repository is live.
Until that feature is configured, contact the maintainer through a private
channel rather than filing a public issue. The public repository will document
the private reporting URL when it exists.

Security fixes are released after reproduction, impact assessment, a regression
test where appropriate, and verification against a clean build. Supported
versions and response targets will be published with the first release.
