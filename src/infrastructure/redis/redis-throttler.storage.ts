import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

const incrementScript = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(ARGV[2]) + 1, 0, 1, blockTtl}
end

local totalHits = redis.call('INCR', KEYS[1])
local timeToExpire = redis.call('PTTL', KEYS[1])
if timeToExpire < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  timeToExpire = tonumber(ARGV[1])
end

if totalHits > tonumber(ARGV[2]) then
  local blockDuration = tonumber(ARGV[3])
  redis.call('SET', KEYS[2], '1', 'PX', blockDuration)
  return {totalHits, timeToExpire, 1, blockDuration}
end

return {totalHits, timeToExpire, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = 'throttle',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const baseKey = `${this.keyPrefix}:${throttlerName}:${key}`;
    const blockKey = `${baseKey}:block`;
    const result: unknown = await this.redis.eval(
      incrementScript,
      2,
      baseKey,
      blockKey,
      ttl,
      limit,
      blockDuration || ttl,
    );
    const [totalHits, timeToExpire, blocked, timeToBlockExpire] =
      parseResult(result);

    return {
      totalHits,
      timeToExpire: toSeconds(timeToExpire),
      isBlocked: blocked === 1,
      timeToBlockExpire: toSeconds(timeToBlockExpire),
    };
  }
}

function parseResult(value: unknown): [number, number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((item) => typeof item === 'number')
  ) {
    throw new Error('Resposta inválida do Redis para o rate limiter.');
  }
  return [value[0], value[1], value[2], value[3]];
}

// O throttler publica esses valores em Retry-After e X-RateLimit-Reset, que são segundos.
function toSeconds(milliseconds: number): number {
  return milliseconds > 0 ? Math.ceil(milliseconds / 1000) : 0;
}
