import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Validates a request body/query with a zod schema and returns friendly field errors. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Please check the highlighted fields',
        issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
