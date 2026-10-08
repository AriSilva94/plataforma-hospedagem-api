import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { PASSWORD_RESET_COOLDOWN_MINUTES } from './password-reset.policy';

export const EMAIL_QUEUE_NAME = 'emails';

export type EmailJobs = {
  welcome: { userId: string };
  'password-reset': { email: string };
  'password-changed': { userId: string };
};

export type EmailJobName = keyof EmailJobs;
export type EmailJobData = EmailJobs[EmailJobName];

export function queuePrefix(environmentService: EnvironmentService): string {
  return environmentService.get('QUEUE_PREFIX') ?? 'bull';
}

@Injectable()
export class EmailQueue implements OnModuleDestroy {
  private readonly logger = new Logger(EmailQueue.name);
  private readonly queue: Queue<EmailJobData, void, EmailJobName>;

  constructor(environmentService: EnvironmentService) {
    this.queue = new Queue(EMAIL_QUEUE_NAME, {
      connection: {
        url: environmentService.getOrThrow('REDIS_URL'),
        enableOfflineQueue: false,
      },
      prefix: queuePrefix(environmentService),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 1000 },
      },
    });
    this.queue.on('error', (error) => {
      this.logger.error(`Falha na fila de e-mails: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async enqueueWelcome(userId: string): Promise<void> {
    await this.queue.add('welcome', { userId });
  }

  async enqueuePasswordChanged(userId: string): Promise<void> {
    await this.queue.add('password-changed', { userId });
  }

  async enqueuePasswordReset(email: string): Promise<void> {
    await this.queue.add(
      'password-reset',
      { email },
      {
        deduplication: {
          id: createHash('sha256').update(email).digest('hex'),
          ttl: PASSWORD_RESET_COOLDOWN_MINUTES * 60 * 1000,
        },
      },
    );
  }
}
