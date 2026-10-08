import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { EMAIL_VERIFICATION_COOLDOWN_MINUTES } from './email-verification.policy';
import { PASSWORD_RESET_COOLDOWN_MINUTES } from './password-reset.policy';

export const EMAIL_QUEUE_NAME = 'emails';

export type EmailJobs = {
  welcome: { userId: string };
  registration: { pendingRegistrationId: string };
  'email-verification': { userId: string };
  'password-reset': { email: string };
  'password-changed': { userId: string };
};

export type EmailJobName = keyof EmailJobs;
export type EmailJobData = EmailJobs[EmailJobName];

export function queuePrefix(environmentService: EnvironmentService): string {
  return environmentService.get('QUEUE_PREFIX') ?? 'bull';
}

function oncePer(minutes: number, scope: string, value: string) {
  return {
    deduplication: {
      id: createHash('sha256').update(`${scope}:${value}`).digest('hex'),
      ttl: minutes * 60 * 1000,
    },
  };
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
    await this.addWithoutFailing('welcome', userId);
  }

  async enqueuePasswordChanged(userId: string): Promise<void> {
    await this.addWithoutFailing('password-changed', userId);
  }

  private async addWithoutFailing(
    name: 'welcome' | 'password-changed',
    userId: string,
  ): Promise<void> {
    try {
      await this.queue.add(name, { userId });
    } catch (error) {
      this.logger.error(
        `Falha ao enfileirar e-mail ${name} para o usuário ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async enqueuePasswordReset(email: string): Promise<void> {
    await this.queue.add(
      'password-reset',
      { email },
      oncePer(PASSWORD_RESET_COOLDOWN_MINUTES, 'password-reset', email),
    );
  }

  async enqueueRegistration(
    pendingRegistrationId: string,
    email: string,
  ): Promise<void> {
    await this.queue.add(
      'registration',
      { pendingRegistrationId },
      oncePer(EMAIL_VERIFICATION_COOLDOWN_MINUTES, 'registration', email),
    );
  }

  async enqueueEmailVerification(userId: string): Promise<void> {
    await this.queue.add(
      'email-verification',
      { userId },
      oncePer(EMAIL_VERIFICATION_COOLDOWN_MINUTES, 'verification', userId),
    );
  }
}
