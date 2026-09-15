import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const baseKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${baseKey}:block`;
    const blockTtl = await this.redis.pttl(blockKey);

    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: blockTtl,
      };
    }

    const totalHits = await this.redis.incr(baseKey);
    if (totalHits === 1) {
      await this.redis.pexpire(baseKey, ttl);
    }
    const timeToExpire = await this.redis.pttl(baseKey);

    if (totalHits > limit) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration || ttl);
      return {
        totalHits,
        timeToExpire,
        isBlocked: true,
        timeToBlockExpire: blockDuration || ttl,
      };
    }

    return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
