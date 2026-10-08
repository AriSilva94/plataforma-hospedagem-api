import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { AuthService } from './auth.service';
import {
  EMAIL_QUEUE_NAME,
  EmailJobData,
  EmailJobName,
  EmailJobs,
  queuePrefix,
} from './email-queue';
import { EmailService } from './email.service';

type EmailJob = Job<EmailJobData, void, EmailJobName>;

@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
  private worker?: Worker<EmailJobData, void, EmailJobName>;

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(EMAIL_QUEUE_NAME, (job) => this.process(job), {
      connection: {
        url: this.environmentService.getOrThrow('REDIS_URL'),
        maxRetriesPerRequest: null,
      },
      prefix: queuePrefix(this.environmentService),
      concurrency: 5,
    });
    this.worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.logger.error(
          `E-mail ${job.name} (job ${job.id}) descartado após ${job.attemptsMade} tentativas: ${error.message}`,
        );
      }
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Falha no worker de e-mails: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: EmailJob): Promise<void> {
    switch (job.name) {
      case 'password-reset': {
        const { email } = job.data as EmailJobs['password-reset'];
        return this.authService.issuePasswordReset(email);
      }
      case 'welcome': {
        const user = await this.findActiveUser(job);
        return user && this.emailService.sendWelcome(user.email, user.name);
      }
      case 'password-changed': {
        const user = await this.findActiveUser(job);
        return user && this.emailService.sendPasswordChanged(user.email);
      }
    }
  }

  private async findActiveUser(job: EmailJob) {
    const { userId } = job.data as EmailJobs['welcome' | 'password-changed'];
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.status === 'ACTIVE' ? user : undefined;
  }
}
