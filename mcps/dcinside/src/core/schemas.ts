import { z } from 'zod';
import { GALLERY_ID_PATTERN } from './dc-url.js';

export const urlInputSchema = z
  .object({
    url: z.string().min(1).max(2_048),
  })
  .strip();

export const searchPostsInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    galleryId: z.string().regex(GALLERY_ID_PATTERN).optional(),
    galleryType: z.enum(['major', 'minor', 'mini']).optional(),
    freshness: z.enum(['any', 'day', 'week', 'month', 'year']).default('any'),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strip()
  .superRefine((value, context) => {
    if (value.galleryType !== undefined && value.galleryId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['galleryType'],
        message: 'galleryType requires galleryId.',
      });
    }
  });

export const importedCommentInputSchema = z
  .object({
    text: z.string().min(1).max(5_000),
    commentId: z.string().max(200).optional(),
    postedAt: z.string().max(100).optional(),
  })
  .strip();

export const importPostInputSchema = z
  .object({
    url: z.string().min(1).max(2_048),
    title: z.string().min(1).max(500),
    bodyText: z.string().max(100_000),
    comments: z.array(importedCommentInputSchema).max(100).default([]),
    note: z.string().max(2_000).optional(),
  })
  .strip()
  .superRefine((value, context) => {
    if (value.title.trim().length === 0) {
      context.addIssue({ code: 'custom', path: ['title'], message: 'title must not be blank.' });
    }
    if (value.bodyText.trim().length === 0 && value.comments.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['bodyText'],
        message: 'Provide nonempty bodyText or at least one comment.',
      });
    }
  });

export const getCommentsInputSchema = z
  .object({
    url: z.string().min(1).max(2_048),
    offset: z.number().int().min(0).max(10_000).default(0),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strip();

export type SearchPostsInput = z.infer<typeof searchPostsInputSchema>;
export type ImportPostInput = z.infer<typeof importPostInputSchema>;
export type GetCommentsInput = z.infer<typeof getCommentsInputSchema>;
