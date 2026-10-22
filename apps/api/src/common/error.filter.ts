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
    } else if (exception instanceof Prisma.PrismaClientInitializationError || isDbDown(exception)) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      body = { message: "We're having a technical problem. Please try again in a few minutes.", down: true };
    }

    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(`${ref} ${req?.method} ${req?.url} → ${status}: ${err?.message ?? exception}`, err?.stack);
    }
    res.status(status).json({ statusCode: status, ...body, ref });
  }
}

function isDbDown(e: unknown): boolean {
  const msg = (e as Error)?.message ?? '';
  return /Can't reach database server|ECONNREFUSED|Connection terminated/i.test(msg);
}
