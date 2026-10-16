import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { prisma, R2_BUCKET, s3, SEED_EMAIL_DOMAIN } from './seed-clients';

async function deleteSeedMedia(): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: 'seed/',
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (listed.Contents ?? []).map((object) => object.Key!);
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
      deleted += keys.length;
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return deleted;
}

async function main(): Promise<void> {
  const { count: propertyCount } = await prisma.property.deleteMany({
    where: {
      ownerProfile: { user: { email: { endsWith: SEED_EMAIL_DOMAIN } } },
    },
  });
  const { count: userCount } = await prisma.user.deleteMany({
    where: { email: { endsWith: SEED_EMAIL_DOMAIN } },
  });
  const mediaCount = await deleteSeedMedia();
  console.log(
    `Seed removido: ${propertyCount} imóveis, ${userCount} usuários e ${mediaCount} mídias excluídos.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    s3.destroy();
  });
