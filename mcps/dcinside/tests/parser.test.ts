import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isGalleryPage, parseComments, parseGalleryPosts, parsePost } from "../src/dcinside/parser.js";

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("DCInside fixture parsers", () => {
  it("parses a gallery page", async () => {
    const html = await fixture("gallery-list.html");
    const result = parseGalleryPosts(html, "programming", "major", 1);

    expect(isGalleryPage(html, "programming")).toBe(true);
    expect(result.galleryName).toBe("프로그래밍");
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]).toMatchObject({ id: "1476608", isNotice: true, comments: 109 });
    expect(result.posts[1]).toMatchObject({
      id: "2940657",
      title: "요즘 신입 개발자 면접관 들어가면서 드는 생각",
      author: "프갤러 (211.196)",
      views: 39,
    });
  });

  it("parses a search result page and its continuation cursor", async () => {
    const result = parseGalleryPosts(await fixture("search-results.html"), "programming", "major", 1);

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({ id: "2935230", comments: 7 });
    expect(result.nextSearchPosition).toBe("-2868483");
  });

  it("parses post metadata and readable text", async () => {
    const result = parsePost(
      await fixture("post.html"),
      "programming",
      "major",
      "2940657",
      "https://gall.dcinside.com/board/view/?id=programming&no=2940657",
    );

    expect(result.title).toContain("요즘 신입 개발자");
    expect(result.content).toContain("개발 지식에 대한 깊이");
    expect(result.content).toContain("참고 링크 (https://example.com/reference)");
    expect(result.content).not.toContain("this must not appear");
    expect(result.links).toEqual(["https://example.com/reference"]);
    expect(result.imageUrls).toEqual(["https://dcimg.example/image.jpg"]);
    expect(result.commentToken).toBe("0f317ce69463bdf3");
  });

  it("parses comments and reply relationships", async () => {
    const data = JSON.parse(await fixture("comments.json")) as unknown;
    const result = parseComments(data, "1476608", 1);

    expect(result.totalCount).toBe(109);
    expect(result.totalPages).toBe(2);
    expect(result.comments).toHaveLength(2);
    expect(result.comments[1]).toMatchObject({
      id: "8846772",
      parentId: "5248988",
      depth: 1,
      content: "답글 & 링크 example",
    });
  });

  it("fails explicitly when upstream parser markers disappear", () => {
    expect(() => parseGalleryPosts("<html></html>", "missing", "major", 1)).toThrow("Failed to parse gallery page");
    expect(() => parseComments({}, "1", 1)).toThrow("Failed to fetch comments");
  });
});
