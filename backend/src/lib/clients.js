// Module-scope AWS clients — created once per container, reused across warm invocations.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';

const base = new DynamoDBClient({});
export const ddbDoc = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true },
});
export const s3 = new S3Client({});
export const ssm = new SSMClient({});

export const TABLE_NAME = process.env.TABLE_NAME;
export const IMAGE_BUCKET = process.env.IMAGE_BUCKET;
