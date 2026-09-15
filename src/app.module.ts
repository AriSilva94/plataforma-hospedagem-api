import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { EnvironmentModule } from './infrastructure/environment/environment.module';
import { EnvironmentService } from './infrastructure/environment/environment.service';
import { REDIS_CLIENT, RedisModule } from './infrastructure/redis/redis.module';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    EnvironmentModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT, EnvironmentService],
      useFactory: (redis: Redis, environmentService: EnvironmentService) => ({
        throttlers: [
          {
            ttl: Number(environmentService.get('THROTTLE_TTL_MS') ?? 60000),
            limit: Number(environmentService.get('THROTTLE_LIMIT') ?? 100),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
