// Build participant/host links for the PUBLIC console from the master console's
// own location. The master console is served from an isolated domain, so we
// can't use its origin as-is:
//   - CloudFront domain (*.cloudfront.net): keep the backend-provided links
//     (they point at the public CloudFront distribution).
//   - Custom domain `quiz-master.<rest>`: swap the leading label to `quiz.`
//     → the public console lives at `quiz.<rest>`.
//   - Anything else: fall back to the current origin.
//
// `loc` defaults to window.location but is injectable for tests.

// Returns the public-console base URL (no trailing slash), or null when the
// backend-provided absolute URL should be used as-is (CloudFront case).
export function publicBase(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (!loc) return null;
  const { hostname, protocol, origin } = loc;
  if (!hostname) return null;
  if (hostname.endsWith('.cloudfront.net')) return null; // use backend link
  if (hostname.startsWith('quiz-master.')) {
    return `${protocol}//${hostname.replace(/^quiz-master\./, 'quiz.')}`;
  }
  return origin;
}

// Rewrite a backend-provided URL (e.g. https://<cdn>/play?code=XX) so its
// origin matches the public console derived from the master location. When
// publicBase() returns null (CloudFront), the original URL is returned.
export function rewriteToPublic(url, loc) {
  const base = publicBase(loc);
  if (!base || !url) return url;
  try {
    const u = new URL(url);
    return `${base}${u.pathname}${u.search}`;
  } catch {
    return url; // not an absolute URL → leave untouched
  }
}

// Convenience: build both links for a code from the public base. Falls back to
// the provided backend URLs when on CloudFront.
export function buildLinks(code, { participantUrl, hostUrl } = {}, loc) {
  const base = publicBase(loc);
  if (!base) {
    return { participantUrl: participantUrl || '', hostUrl: hostUrl || '' };
  }
  const c = encodeURIComponent(code);
  return {
    participantUrl: `${base}/play?code=${c}`,
    hostUrl: `${base}/host?code=${c}`,
  };
}
