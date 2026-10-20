import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { REDIS_CLIENT } from '../infrastructure/redis/redis.module';

export const MAX_LOGIN_FAILURES = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class LoginAttempts {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly environmentService: EnvironmentService,
  ) {}

  async assertAllowed(email: string): Promise<void> {
    const failures = Number((await this.redis.get(this.key(email))) ?? 0);
    if (failures >= MAX_LOGIN_FAILURES) {
      throw new HttpException(
        'Muitas tentativas de login para este e-mail. Tente novamente em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(email: string): Promise<void> {
    const key = this.key(email);
    await this.redis
      .multi()
      .set(key, 0, 'PX', LOGIN_FAILURE_WINDOW_MS, 'NX')
      .incr(key)
      .exec();
  }

  async clear(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }

  private key(email: string): string {
    const prefix =
      this.environmentService.get('THROTTLE_KEY_PREFIX') ?? 'throttle';
    const emailHash = createHash('sha256').update(email).digest('hex');
    return `${prefix}:login-failures:${emailHash}`;
  }
}
