import * as cheerio from "cheerio";
import type {
  Comment,
  GalleryPostSummary,
  GalleryType,
  ParsedCommentPage,
  ParsedGalleryPage,
  ParsedPost,
} from "./types.js";

const BASE_URL = "https://gall.dcinside.com";

function numberFrom(text: string): number | undefined {
  const value = Number.parseInt(text.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(value) ? value : undefined;
}

function cleanText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, BASE_URL).toString();
  } catch {
    return url;
  }
}

function optionalText(text: string): string | undefined {
  const cleaned = cleanText(text);
  return cleaned || undefined;
}

function authorText(name: string, ip?: string): string | undefined {
  const cleanedName = cleanText(name);
  if (!cleanedName) return undefined;
  return ip ? `${cleanedName} (${ip})` : cleanedName;
}

export function isGalleryPage(html: string, galleryId: string): boolean {
  const $ = cheerio.load(html);
  return $("#gallery_id").attr("value") === galleryId && Boolean($("#gallery_name").attr("value"));
}

export function parseGalleryPosts(
  html: string,
  galleryId: string,
  galleryType: GalleryType,
  page: number,
): ParsedGalleryPage {
  const $ = cheerio.load(html);
  const galleryName = $("#gallery_name").attr("value") ?? "";
  if (!galleryName) throw new Error("Failed to parse gallery page: gallery metadata was not found");
  if ($("tbody.listwrap2").length === 0) throw new Error("Failed to parse gallery page: post list was not found");

  const posts: GalleryPostSummary[] = $("tr.ub-content[data-no]").map((_, row) => {
    const element = $(row);
    const titleCell = element.find(".gall_tit").first();
    const titleLink = titleCell.find("a[href]").not(".reply_numbox").first();
    const writer = element.find(".gall_writer").first();
    const date = element.find(".gall_date").first();
    const id = element.attr("data-no") ?? cleanText(element.find(".gall_num").text());
    const titleClone = titleLink.clone();
    titleClone.find("em.icon_img").remove();

    return {
      id,
      title: cleanText(titleClone.text()),
      author: authorText(writer.attr("data-nick") || writer.find(".nickname").text() || writer.text(), writer.attr("data-ip")),
      date: optionalText(date.attr("title") || date.text()),
      views: numberFrom(element.find(".gall_count").text()),
      recommendations: numberFrom(element.find(".gall_recommend").text()),
      comments: numberFrom(titleCell.find(".reply_num").text()) ?? 0,
      url: absoluteUrl(titleLink.attr("href") ?? ""),
      isNotice: (element.attr("data-type") ?? "").includes("notice"),
    };
  }).get().filter((post) => /^\d+$/.test(post.id) && post.title.length > 0 && post.url.startsWith(BASE_URL));

  let nextSearchPosition: string | undefined;
  let nextPage: number | undefined;
  $(".bottom_paging_box a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href) return;
    try {
      const target = new URL(href, BASE_URL);
      const searchPosition = target.searchParams.get("search_pos");
      if (searchPosition) {
        nextSearchPosition = searchPosition;
        return;
      }
      const candidatePage = numberFrom(target.searchParams.get("page") ?? "");
      if (candidatePage && candidatePage > page && (nextPage === undefined || candidatePage < nextPage)) {
        nextPage = candidatePage;
      }
    } catch {
      // Ignore malformed upstream navigation links.
    }
  });

  return { galleryId, galleryName, galleryType, page, posts, nextPage, nextSearchPosition };
}

export function parsePost(
  html: string,
  galleryId: string,
  galleryType: GalleryType,
  postId: string,
  url: string,
): ParsedPost {
  const $ = cheerio.load(html);
  const title = cleanText($(".title_subject").first().text());
  if (!title) throw new Error("Post not found or failed to parse post page");

  const writer = $(".gallview_head .gall_writer").first();
  const originalContent = $(".writing_view_box .write_div").first();
  if (originalContent.length === 0) throw new Error("Failed to parse post content");

  const imageUrls = new Set<string>();
  originalContent.find("img, video, source").each((_, media) => {
    const value = $(media).attr("data-original") || $(media).attr("data-src") || $(media).attr("src");
    if (value) imageUrls.add(absoluteUrl(value));
  });
  const links = originalContent.find("a[href]").map((_, anchor) => absoluteUrl($(anchor).attr("href") ?? "")).get();

  const content = originalContent.clone();
  content.find("script, style, noscript, iframe").remove();
  content.find("a[href]").each((_, anchor) => {
    const element = $(anchor);
    const href = absoluteUrl(element.attr("href") ?? "");
    const text = cleanText(element.text());
    element.replaceWith(text && text !== href ? `${text} (${href})` : href);
  });
  content.find("img, video, source").each((_, media) => {
    const element = $(media);
    const value = element.attr("data-original") || element.attr("data-src") || element.attr("src");
    element.replaceWith(value ? `\n[media: ${absoluteUrl(value)}]\n` : "");
  });
  content.find("blockquote").each((_, quote) => {
    const text = cleanText($(quote).text()).split("\n").map((line) => `> ${line}`).join("\n");
    $(quote).replaceWith(`\n${text}\n`);
  });
  content.find("br").replaceWith("\n");
  content.find("p, div, li, pre").each((_, element) => { $(element).append("\n"); });

  const heading = optionalText($(".title_headtext").first().text());
  return {
    id: postId,
    galleryId,
    galleryType,
    title: heading ? `${heading} ${title}` : title,
    author: authorText(writer.attr("data-nick") || writer.find(".nickname").first().text(), writer.attr("data-ip")),
    date: optionalText(writer.find(".gall_date").attr("title") || writer.find(".gall_date").text()),
    views: numberFrom(writer.find(".gall_count").text()),
    recommendations: numberFrom(writer.find(".gall_reply_num").text()),
    content: cleanText(content.text()),
    imageUrls: [...imageUrls],
    links: [...new Set(links)],
    url,
    commentToken: $("#e_s_n_o").attr("value") ?? "",
  };
}

interface RawComment {
  no?: string | number;
  c_no?: string | number;
  name?: string;
  ip?: string;
  reg_date?: string;
  memo?: string;
  depth?: string | number;
  del_yn?: string;
  is_delete?: string | number;
}

interface RawCommentResponse {
  total_cnt?: string | number;
  comments?: RawComment[] | null;
  pagination?: string;
}

function commentText(memo: string): string {
  const $ = cheerio.load(`<body>${memo}</body>`);
  $("br").replaceWith("\n");
  return cleanText($("body").text());
}

export function parseComments(data: unknown, postId: string, page: number): ParsedCommentPage {
  if (!data || typeof data !== "object") throw new Error("Failed to fetch comments: invalid response");
  const response = data as RawCommentResponse;
  if (!("comments" in response) || !("total_cnt" in response)) {
    throw new Error("Failed to fetch comments: expected fields were not found");
  }
  const rawComments = Array.isArray(response.comments) ? response.comments : [];
  const comments: Comment[] = rawComments.map((comment) => {
    const depth = numberFrom(String(comment.depth ?? 0)) ?? 0;
    return {
      id: comment.no === undefined ? undefined : String(comment.no),
      author: authorText(comment.name ?? "", comment.ip),
      content: commentText(comment.memo ?? ""),
      date: optionalText(comment.reg_date ?? ""),
      depth,
      parentId: depth > 0 ? String(comment.c_no ?? "") || undefined : undefined,
      isDeleted: comment.del_yn === "Y" || String(comment.is_delete) === "1",
    };
  });

  const pageNumbers = [page];
  for (const match of (response.pagination ?? "").matchAll(/viewComments\((\d+)/g)) {
    pageNumbers.push(numberFrom(match[1] ?? "") ?? page);
  }
  return {
    postId,
    page,
    totalCount: numberFrom(String(response.total_cnt ?? comments.length)) ?? comments.length,
    totalPages: Math.max(...pageNumbers),
    comments,
  };
}
