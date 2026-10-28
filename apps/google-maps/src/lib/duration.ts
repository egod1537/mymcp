import { GoogleMapsError } from './errors.js';

const durationPattern = /^(-?(?:\d+)(?:\.\d+)?)s$/;

export function parseGoogleDuration(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google returned a route duration in an unsupported format.',
    );
  }

  const match = durationPattern.exec(value);
  const seconds = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google returned a malformed route duration.',
    );
  }
  return seconds;
}
