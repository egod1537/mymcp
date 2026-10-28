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
    sort: z.enum(['relevance', 'latest']).default('relevance'),
    source: z.enum(['authorized', 'brave', 'local']).default('authorized'),
    keywords: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    maxPages: z.number().int().min(1).max(3).default(1),
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
    parentCommentId: z.string().max(200).optional(),
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
    sourceMode: z.enum(['local', 'authorized']).default('local'),
  })
  .strip();

export const getPostInputSchema = urlInputSchema.extend({
  sourceMode: z.enum(['local', 'authorized']).default('local'),
  preferImages: z.boolean().default(false),
});

export const listGalleryPostsInputSchema = z
  .object({
    galleryId: z.string().regex(GALLERY_ID_PATTERN),
    galleryType: z.enum(['major', 'minor', 'mini']).optional(),
    page: z.number().int().min(1).max(100).default(1),
    boardType: z.enum(['all', 'recommend', 'notice']).default('all'),
    limit: z.number().int().min(1).max(50).default(20),
    sourceMode: z.enum(['local', 'authorized']).default('local'),
  })
  .strip();

export const getPostWithCommentsInputSchema = getCommentsInputSchema;

export const importSearchResultsInputSchema = z
  .object({
    format: z.enum(['csv', 'json']),
    data: z.string(),
    galleryId: z.string().regex(GALLERY_ID_PATTERN).optional(),
    replace: z.boolean().default(false),
  })
  .strip();

export const importPostHtmlInputSchema = z
  .object({
    url: z.string().min(1).max(2_048),
    html: z.string(),
    note: z.string().max(2_000).optional(),
  })
  .strip();

export type SearchPostsInput = z.infer<typeof searchPostsInputSchema>;
export type ImportPostInput = z.infer<typeof importPostInputSchema>;
export type GetCommentsInput = z.infer<typeof getCommentsInputSchema>;
export type GetPostInput = z.infer<typeof getPostInputSchema>;
export type ListGalleryPostsInput = z.infer<typeof listGalleryPostsInputSchema>;
export type ImportSearchResultsInput = z.infer<typeof importSearchResultsInputSchema>;
