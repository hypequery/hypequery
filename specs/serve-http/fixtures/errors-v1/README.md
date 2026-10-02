# Serve HTTP error fixtures, version 1

These language-neutral fixtures pin the public error envelope that every
Hypequery serve implementation returns: `@hypequery/serve` in TypeScript and
`hypequery.serve` in Python. Both run `cases.json` in CI. A divergence is a
bug in an implementation or in this file, never a per-language difference.

## The fixture app

Each implementation builds the app described under `app`: the endpoints at the
given paths with no base path, a bearer credential equal to `app.credential`,
and the stated behaviour. An endpoint described as raising an unexpected error
raises one whose message is `leakCanary`.

## Requests

A case sends `requests` in order against one fresh app instance. Only the last
response is checked against `expect`. An earlier request with `expectStatus`
must return that status. `credential` is:

- `none`: no `Authorization` header;
- `valid`: `Authorization: Bearer <app.credential>`;
- `invalid`: `Authorization: Bearer <app.credential>-wrong`.

`json`, when present, is sent as an `application/json` body.

## Every error response

The envelope rules apply to every case:

- the body is a JSON object whose only key is `error`;
- `error` has a string `type` and a string `message`, and nothing besides
  those and an optional `details` object;
- `details`, when present, has only keys from `allowedDetailKeys`;
- the `x-request-id` header is present and non-empty;
- every header in `requiredHeaders` has exactly that value;
- no string in `leakMarkers` appears anywhere in the body.

## Expectations

- `status`, `type`, and `message` are exact.
- `details` is a subset match: each listed key has exactly that value.
- `noDetails: true` means `details` is absent.
- `issuePaths` lists the `path` arrays of `details.issues`, in order. Each
  issue is an object with an array `path` and a string `message`.
- `headers` are exact values, in addition to the envelope's.
