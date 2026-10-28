import { z } from 'zod';

export const apiSuccessSchema = <T extends z.ZodType>(data: T) =>
  z
    .object({
      apiVersion: z.literal(1),
      data,
    })
    .strict();

export type ApiSuccess<T> = { apiVersion: 1; data: T };
