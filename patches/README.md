# URI security backport retired with SDK 58

SDK 57 required a CommonJS-compatible security backport for
`decode-uri-component@0.2.2` (GHSA-vcc3-ghjq-m6fr).

SDK 58 / Expo Router 58 no longer depend on `query-string` or
`decode-uri-component`. The patch and `patch-package` postinstall hook were
removed as part of the upgrade. Do not reintroduce the vulnerable dependency.

`node scripts/test-uri-decoding-security.mjs` verifies the current Router URL
helpers with Japanese titles, authentication parameters, and malformed input.
