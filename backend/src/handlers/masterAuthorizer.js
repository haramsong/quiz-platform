// HTTP API Lambda Authorizer (simple response v2.0) for master routes.
import { getMasterKey } from '../lib/ssm.js';
import { safeEqual } from '../lib/auth.js';

export const handler = async (event) => {
  const provided =
    event.headers?.['x-master-key'] ||
    event.identitySource?.[0] ||
    '';
  try {
    const key = await getMasterKey();
    const isAuthorized = Boolean(key) && safeEqual(provided, key);
    return { isAuthorized };
  } catch {
    return { isAuthorized: false };
  }
};
