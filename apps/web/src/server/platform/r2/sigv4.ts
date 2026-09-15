/**
 * Hand-rolled AWS SigV4 for Cloudflare R2 (W912).
 *
 * NO AWS SDK: the whole signer is ~120 lines over `node:crypto` (the work
 * order's preferred shape — heavy SDKs are the engine's no-dep rule applied to
 * the hosted app too). Two entry points:
 *
 * - `signAwsRequest` — header-signed REST call (PUT/GET/DELETE/HEAD objects);
 * - `presignGetUrl` — a query-signed, SHORT-LIVED GET URL
 *   (`X-Amz-Expires`), the only authorized delivery form for private objects.
 *
 * Canonical-request rules implemented per the SigV4 spec: URI-encoded path
 * segments (S3-style: every non-unreserved character encoded), sorted
 * canonical query, lowercase-header canonical headers, `host` always signed,
 * and `UNSIGNED-PAYLOAD` for presigned URLs.
 */
import { createHash, createHmac } from "node:crypto";

/** The credentials the signer needs (from the environment module). */
export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 reports `auto`; the region still participates in the signing key. */
  region: string;
  /** Always `s3` for R2 object operations. */
  service: string;
}

/** Everything `signAwsRequest` needs for one HTTP call. */
export interface AwsRequestSigningInput {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  url: URL;
  /** Extra headers to send (none may override host/content-length). */
  headers?: Record<string, string>;
  /** The request body (PUT). Hashed into the signature. */
  body?: Uint8Array | string;
  credentials: SigV4Credentials;
  /** Override for the signing instant (tests). */
  amzDate?: Date;
}

/** A signed request, ready for `fetch`. */
export interface SignedAwsRequest {
  url: URL;
  method: AwsRequestSigningInput["method"];
  headers: Record<string, string>;
}

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** ISO-basic `YYYYMMDDTHHMMSSZ`. */
export function amzDateFormat(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Datestamp `YYYYMMDD`. */
function dateStamp(date: Date): string {
  return amzDateFormat(date).slice(0, 8);
}

/** RFC 3986 encoding for URI components (SigV4: %20, not `+`). */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The canonical URI: each path segment independently RFC-3986 encoded. */
function canonicalUri(pathname: string): string {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  return `/${segments.map(uriEncode).join("/")}`;
}

/** The canonical query string: keys sorted, values RFC-3986 encoded. */
function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => pairs.push([key, value]));
  pairs.sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
  );
  return pairs.map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`).join("&");
}

/** The signing key (spec: `AWS4 <secret>` → date → region → service). */
function signingKey(credentials: SigV4Credentials, date: Date): Buffer {
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp(date));
  const kRegion = hmac(kDate, credentials.region);
  const kService = hmac(kRegion, credentials.service);
  return hmac(kService, "aws4_request");
}

/** The string-to-sign (canonical request → scope → hash). */
function stringToSign(
  credentials: SigV4Credentials,
  date: Date,
  canonicalRequest: string,
): string {
  return [
    "AWS4-HMAC-SHA256",
    amzDateFormat(date),
    `${dateStamp(date)}/${credentials.region}/${credentials.service}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");
}

/** Signs one REST call with SigV4 headers. */
export function signAwsRequest(input: AwsRequestSigningInput): SignedAwsRequest {
  const date = input.amzDate ?? new Date();
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.url.host,
    "x-amz-date": amzDateFormat(date),
  };
  const payloadHash = input.body === undefined ? sha256Hex("") : sha256Hex(input.body);
  headers["x-amz-content-sha256"] = payloadHash;
  const signedHeaders = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
    .join(";");
  const canonicalHeaders = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
    .map((name) => `${name}:${(headers[name] ?? "").trim()}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const signature = hmac(
    signingKey(input.credentials, date),
    stringToSign(input.credentials, date, canonicalRequest),
  ).toString("hex");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${dateStamp(date)}/` +
    `${input.credentials.region}/${input.credentials.service}/aws4_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: input.url, method: input.method, headers };
}

/** Presigns a GET with query auth and a bounded expiry (seconds). */
export function presignGetUrl(input: {
  url: URL;
  credentials: SigV4Credentials;
  /** Bounded 1..604800 per the SigV4 spec; hosted callers use minutes, not days. */
  expiresSeconds: number;
  amzDate?: Date;
}): string {
  if (
    !Number.isInteger(input.expiresSeconds) ||
    input.expiresSeconds < 1 ||
    input.expiresSeconds > 604_800
  ) {
    throw new Error(`presign expiresSeconds must be an integer in [1, 604800]`);
  }
  const date = input.amzDate ?? new Date();
  const credential = `${input.credentials.accessKeyId}/${dateStamp(date)}/${input.credentials.region}/${input.credentials.service}/aws4_request`;
  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDateFormat(date)],
    ["X-Amz-Expires", input.expiresSeconds.toString()],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const url = new URL(input.url.toString());
  for (const [key, value] of query) url.searchParams.set(key, value);
  // The signature covers the canonical query WITHOUT X-Amz-Signature.
  const canonicalRequest = [
    "GET",
    canonicalUri(url.pathname),
    canonicalQuery(url),
    `host:${url.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const signature = hmac(
    signingKey(input.credentials, date),
    stringToSign(input.credentials, date, canonicalRequest),
  ).toString("hex");
  url.searchParams.set("X-Amz-Signature", signature);
  return url.toString();
}
