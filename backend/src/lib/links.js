// Build participant/host links from the public CDN domain + code (not stored).
export function buildLinks(code) {
  const domain = process.env.PUBLIC_CDN_DOMAIN || '';
  const base = domain ? `https://${domain}` : '';
  return {
    participantUrl: `${base}/play?code=${code}`,
    hostUrl: `${base}/host?code=${code}`,
  };
}
