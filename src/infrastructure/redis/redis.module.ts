import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvironmentService } from '../environment/environment.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(environmentService: EnvironmentService) {
    super(environmentService.getOrThrow('REDIS_URL'));
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}

@Global()
@Module({
  providers: [
    RedisService,
    { provide: REDIS_CLIENT, useExisting: RedisService },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
