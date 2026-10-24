import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * One shape for every error the apps receive: { statusCode, message, ref, ...extra }.
 * Users never see technical details; the full error is logged with the same reference.
 */
@Catch()
export class AllErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const ref: string = req?.ref ?? 'ML-UNKNOWN';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Something went wrong on our side. Please try again.' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { message: r } : { ...(r as object) };
      if (Array.isArray(body.message)) body.message = (body.message as string[]).join(', ');
      delete body.error;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      body = { message: 'This already exists. Please refresh and check.' };
    } else if (blockedByDatabase(exception)) {
      // A database safety rule refused the change (e.g. a Schedule X medicine). Show its plain-language reason.
      status = HttpStatus.CONFLICT;
      body = { message: blockedByDatabase(exception)! };
    } else if (/row-level security|permission denied for/i.test((exception as Error)?.message ?? '')) {
      status = HttpStatus.FORBIDDEN;
      body = { message: 'You do not have access to this' };
      // Row-level security stopped a query the app should never have made: a bug or an attack. Always log it.
      this.logger.warn(`${ref} ${req?.method} ${req?.url} blocked by row-level security: ${(exception as Error).message.split('\n').pop()}`);
    } else if (exception instanceof Prisma.PrismaClientInitializationError || isDbDown(exception)) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      body = { message: "We're having a technical problem. Please try again in a few minutes.", down: true };
    }

    // Log real failures only (planned maintenance and other deliberate 5xx answers are not errors).
    if (!(exception instanceof HttpException) && status >= 500) {
      const err = exception as Error;
      this.logger.error(`${ref} ${req?.method} ${req?.url} → ${status}: ${err?.message ?? exception}`, err?.stack);
    }
    res.status(status).json({ statusCode: status, ...body, ref });
  }
}

/** The message of a MEDILINK_BLOCKED exception raised by a database trigger, if this is one. */
export function blockedByDatabase(e: unknown): string | null {
  const m = /MEDILINK_BLOCKED: ([^\n"]+)/.exec((e as Error)?.message ?? '');
  return m ? `${m[1].trim().replace(/\.$/, '')}.` : null;
}

function isDbDown(e: unknown): boolean {
  const msg = (e as Error)?.message ?? '';
  return /Can't reach database server|ECONNREFUSED|Connection terminated/i.test(msg);
}
