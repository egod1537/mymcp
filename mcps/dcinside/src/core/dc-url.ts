import { DomainError } from '../errors.js';

export const GALLERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type GalleryType = 'major' | 'minor' | 'mini';

export interface ParsedPostUrl {
  canonicalUrl: string;
  galleryId: string;
  galleryType: GalleryType;
  postNo: string;
}

const PATH_TYPES = new Map<string, { canonicalPath: string; galleryType: GalleryType }>([
  ['/board/view', { canonicalPath: '/board/view/', galleryType: 'major' }],
  ['/board/view/', { canonicalPath: '/board/view/', galleryType: 'major' }],
  ['/mgallery/board/view', { canonicalPath: '/mgallery/board/view/', galleryType: 'minor' }],
  ['/mgallery/board/view/', { canonicalPath: '/mgallery/board/view/', galleryType: 'minor' }],
  ['/mini/board/view', { canonicalPath: '/mini/board/view/', galleryType: 'mini' }],
  ['/mini/board/view/', { canonicalPath: '/mini/board/view/', galleryType: 'mini' }],
]);

function invalid(message: string): never {
  throw new DomainError('INPUT_INVALID', message, false);
}

export function parseDcPostUrl(value: string): ParsedPostUrl {
  if (value.length < 1 || value.length > 2_048 || value !== value.trim()) {
    invalid('URL must contain 1 to 2048 characters without surrounding whitespace.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid('URL is not valid.');
  }

  const authority = /^https:\/\/([^/?#]*)/.exec(value)?.[1];
  if (
    url.protocol !== 'https:' ||
    authority !== 'gall.dcinside.com' ||
    url.hostname !== 'gall.dcinside.com' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    invalid('URL must use https://gall.dcinside.com without credentials or a port.');
  }

  const path = PATH_TYPES.get(url.pathname);
  if (!path) invalid('URL path is not a supported DCInside post path.');

  const galleryIds = url.searchParams.getAll('id');
  const postNumbers = url.searchParams.getAll('no');
  if (galleryIds.length !== 1 || postNumbers.length !== 1) {
    invalid('URL must contain exactly one id and one no parameter.');
  }

  const galleryId = galleryIds[0] ?? '';
  const rawPostNo = postNumbers[0] ?? '';
  if (!GALLERY_ID_PATTERN.test(galleryId)) {
    invalid('Gallery id must contain 1 to 64 ASCII letters, digits, underscores, or hyphens.');
  }
  if (!/^\d+$/.test(rawPostNo)) invalid('Post number must be a positive integer.');

  const postNo = rawPostNo.replace(/^0+(?=\d)/, '');
  if (postNo === '0') invalid('Post number must be greater than zero.');

  return {
    canonicalUrl: `https://gall.dcinside.com${path.canonicalPath}?id=${galleryId}&no=${postNo}`,
    galleryId,
    galleryType: path.galleryType,
    postNo,
  };
}
