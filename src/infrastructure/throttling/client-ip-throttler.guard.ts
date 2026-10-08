import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { isIP } from 'net';

type TrustedSenders = {
  internalSecret?: string;
  cloudflareSecret?: string;
};

function ipFromHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}

function carriesSecret(
  request: Request,
  header: string,
  secret: string | undefined,
): boolean {
  const candidate = request.headers[header];
  if (!secret || typeof candidate !== 'string') {
    return false;
  }
  const candidateBytes = Buffer.from(candidate);
  const secretBytes = Buffer.from(secret);
  return (
    candidateBytes.length === secretBytes.length &&
    timingSafeEqual(candidateBytes, secretBytes)
  );
}

export function resolveClientIp(
  request: Request,
  { internalSecret, cloudflareSecret }: TrustedSenders,
): string {
  const forwardedByFrontend = carriesSecret(
    request,
    'x-internal-secret',
    internalSecret,
  )
    ? ipFromHeader(request, 'x-client-ip')
    : undefined;
  const reportedByCloudflare = carriesSecret(
    request,
    'x-origin-secret',
    cloudflareSecret,
  )
    ? ipFromHeader(request, 'cf-connecting-ip')
    : undefined;

  return forwardedByFrontend ?? reportedByCloudflare ?? request.ip ?? 'unknown';
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(request: Request): Promise<string> {
    return Promise.resolve(
      resolveClientIp(request, {
        internalSecret: process.env.INTERNAL_API_SECRET,
        cloudflareSecret: process.env.CLOUDFLARE_ORIGIN_SECRET,
      }),
    );
  }
}
