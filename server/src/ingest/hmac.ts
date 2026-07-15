// Timing-safe HMAC-SHA256 verification for the webhook front door. Verifies
// against the *raw* request body (captured before JSON parsing) so the
// signature check is immune to key-order/whitespace re-serialization.
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify `signatureHeader` is the HMAC-SHA256 (hex-encoded) of `rawBody`
 * using `secret`. Returns false for any malformed/missing/mismatched input
 * — never throws, so callers can treat it as a simple boolean gate.
 */
export function verifyHmac(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Strip an optional "sha256=" prefix (common convention, e.g. GitHub-style).
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');

  // Different lengths would throw in timingSafeEqual; treat as mismatch.
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
