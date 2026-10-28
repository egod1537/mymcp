import { load } from 'cheerio';
import { parseDcPostUrl } from '../core/dc-url.js';
import { sanitizeStoredText } from '../core/text.js';
import type { NormalizedComment } from '../core/types.js';
import { DomainError } from '../errors.js';
import type { ImportPostInput } from '../core/schemas.js';

export const HTML_PARSER_VERSION = 'dcinside-user-html-v1';

const BODY_SELECTORS = [
  '.write_div',
  '.writing_view_box',
  '.write_view_box',
  '.gallview_contents',
  '[data-role="post-content"]',
];
const TITLE_SELECTORS = ['.title_subject', '.gall_tit', 'h1', '[data-role="post-title"]'];
const COMMENT_SELECTORS = [
  '.comment_box .usertxt',
  '.comment_memo',
  '.reply_content',
  '[data-role="comment"]',
];

function textFromHtml(html: string): string {
  const $ = load(html);
  $('script,style,noscript,iframe,object,embed').remove();
  return sanitizeStoredText($.root().text())
    .replace(/\r/g, '')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function htmlFragmentToText(html: string): string {
  return textFromHtml(html);
}

export function parseUserPostHtml(
  url: string,
  html: string,
  note?: string,
): { input: ImportPostInput; imageUrls: string[]; parserVersion: string } {
  if (Buffer.byteLength(html, 'utf8') > 1_048_576) {
    throw new DomainError('INPUT_INVALID', 'HTML import exceeds the 1 MiB limit.', false);
  }
  parseDcPostUrl(url);
  const $ = load(html);
  $('script,style,noscript,iframe,object,embed').remove();
  let title = '';
  for (const selector of TITLE_SELECTORS) {
    title = sanitizeStoredText($(selector).first().text()).trim();
    if (title) break;
  }
  if (!title)
    title = sanitizeStoredText($('meta[property="og:title"]').attr('content') ?? '').trim();

  let bodyText = '';
  let bodyElement: ReturnType<typeof $> | undefined;
  for (const selector of BODY_SELECTORS) {
    const candidate = $(selector).first();
    if (candidate.length > 0) {
      bodyElement = candidate;
      bodyText = textFromHtml(candidate.html() ?? '');
      if (bodyText || candidate.find('img').length > 0) break;
    }
  }
  const imageUrls: string[] = [];
  bodyElement?.find('img').each((_index, element) => {
    const candidate = $(element).attr('src')?.trim();
    if (!candidate) return;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' && /(^|\.)dcinside\.com$/i.test(parsed.hostname)) {
        imageUrls.push(parsed.href);
      }
    } catch {
      // Relative, data, javascript, and malformed image locations are intentionally dropped.
    }
  });

  const comments: NormalizedComment[] = [];
  const seen = new Set<object>();
  for (const selector of COMMENT_SELECTORS) {
    $(selector).each((_index, element) => {
      if (seen.has(element)) return;
      seen.add(element);
      const item = $(element);
      const text = textFromHtml(item.html() ?? item.text());
      if (!text) return;
      const container = item.closest('[data-comment-id],li');
      const commentId = container.attr('data-comment-id')?.trim();
      const parent = container.attr('data-parent-comment-id')?.trim();
      const postedAt = container.attr('data-posted-at')?.trim();
      comments.push({
        text,
        ...(commentId ? { commentId: sanitizeStoredText(commentId).slice(0, 200) } : {}),
        ...(parent && parent !== '0'
          ? { parentCommentId: sanitizeStoredText(parent).slice(0, 200) }
          : {}),
        ...(postedAt ? { postedAt: sanitizeStoredText(postedAt).slice(0, 100) } : {}),
      });
    });
  }

  if (!title || (!bodyText && imageUrls.length === 0 && comments.length === 0)) {
    throw new DomainError(
      'PARSE_FAILED',
      'The supplied HTML did not contain a recognizable title and post body.',
      false,
    );
  }
  return {
    input: {
      url,
      title,
      bodyText,
      comments: comments.map(({ text, commentId, parentCommentId, postedAt }) => ({
        text,
        ...(commentId ? { commentId } : {}),
        ...(parentCommentId ? { parentCommentId } : {}),
        ...(postedAt ? { postedAt } : {}),
      })),
      ...(note === undefined ? {} : { note }),
    },
    imageUrls: [...new Set(imageUrls)],
    parserVersion: HTML_PARSER_VERSION,
  };
}
