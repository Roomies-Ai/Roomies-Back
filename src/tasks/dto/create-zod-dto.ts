import { z } from 'zod';

/**
 * Creates a real class from a Zod schema so TypeScript can emit
 * design:paramtypes metadata for it (required by emitDecoratorMetadata + NestJS).
 * The class instance is typed as the Zod output — full type safety preserved.
 */
export function createZodDto<T extends z.ZodType>(schema: T) {
  class ZodDtoBase {
    static readonly schema: T = schema;
  }
  return ZodDtoBase as unknown as { new(): z.infer<T>; schema: T };
}
