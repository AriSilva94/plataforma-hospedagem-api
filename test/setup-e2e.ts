import { randomUUID } from 'crypto';

process.env.THROTTLE_KEY_PREFIX = `e2e:${randomUUID()}`;
