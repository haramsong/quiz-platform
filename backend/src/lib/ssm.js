// SSM SecureString fetch with cold-start cache.
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { ssm } from './clients.js';

let cached = null;

export async function getMasterKey() {
  if (cached) return cached;
  const name = process.env.MASTER_KEY_PARAM;
  const r = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true })
  );
  cached = r.Parameter?.Value || '';
  return cached;
}
