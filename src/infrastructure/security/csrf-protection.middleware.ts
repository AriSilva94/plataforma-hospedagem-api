import type { NextFunction, Request, RequestHandler, Response } from 'express';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfProtection(frontendUrl: string): RequestHandler {
  const trustedOrigin = new URL(frontendUrl).origin;

  return (request: Request, response: Response, next: NextFunction): void => {
    if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }

    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if (origin === undefined && fetchSite === undefined) {
      next();
      return;
    }

    if (
      fetchSite === 'cross-site' ||
      origin !== trustedOrigin ||
      request.headers['x-csrf-protection'] !== '1'
    ) {
      response.status(403).json({
        statusCode: 403,
        message: 'Origem da requisição não permitida.',
      });
      return;
    }

    next();
  };
}
