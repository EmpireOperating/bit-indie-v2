import { S3Client } from '@aws-sdk/client-s3';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function getS3Config() {
  const endpoint = requiredEnv('S3_ENDPOINT');
  const bucket = requiredEnv('S3_BUCKET');
  const accessKeyId = requiredEnv('S3_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv('S3_SECRET_ACCESS_KEY');
  const region = process.env.S3_REGION ?? 'us-east-1';

  // MinIO typically needs path-style addressing.
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false';

  // Default to 15 minutes.
  const presignExpiresSec = Number(process.env.S3_PRESIGN_EXPIRES_SEC ?? 900);

  return {
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    presignExpiresSec,
  };
}

export function makeS3Client() {
  const cfg = getS3Config();
  return {
    cfg,
    client: new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    }),
  };
}
