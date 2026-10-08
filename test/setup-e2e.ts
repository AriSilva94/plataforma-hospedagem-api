import { randomUUID } from 'crypto';

const runId = randomUUID();

process.env.THROTTLE_KEY_PREFIX = `e2e:${runId}`;
process.env.QUEUE_PREFIX = `e2e-queue:${runId}`;

jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: () => Promise.resolve(),
    close: () => undefined,
  }),
}));
