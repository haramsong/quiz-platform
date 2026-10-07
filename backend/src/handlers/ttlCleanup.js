// DynamoDB Streams (REMOVE / TTL service deletions) -> delete associated S3 images.
import { s3, IMAGE_BUCKET } from '../lib/clients.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

export const handler = async (event) => {
  const records = event.Records || [];
  for (const r of records) {
    if (r.eventName !== 'REMOVE') continue;
    const old = r.dynamodb?.OldImage;
    const imageKey = old?.imageKey?.S;
    if (imageKey) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: IMAGE_BUCKET, Key: imageKey }))
        .catch(() => {});
    }
  }
  return { ok: true };
};
