import { describe, expect, it } from "vitest";
import { DcinsideClient } from "../src/dcinside/client.js";
import { getComments } from "../src/dcinside/comments.js";
import { getGalleryPosts } from "../src/dcinside/gallery.js";
import { getPost } from "../src/dcinside/post.js";
import { searchGalleryPosts } from "../src/dcinside/search.js";
import { Logger } from "../src/utils/logger.js";

describe.runIf(process.env.RUN_LIVE_TESTS === "1")("DCInside live integration", () => {
  it("lists 20 posts and follows search -> post -> comments", async () => {
    const client = new DcinsideClient({ requestIntervalMs: 800, maxConcurrency: 1, logger: new Logger("silent") });
    const recent = await getGalleryPosts(client, { galleryId: "programming", limit: 20 });
    expect(recent.posts).toHaveLength(20);

    const search = await searchGalleryPosts(client, {
      galleryId: "programming",
      query: "typescript",
      searchTarget: "title_content",
      maxPages: 1,
    });
    expect(search.posts.length).toBeGreaterThan(0);

    const selected = search.posts[0];
    expect(selected).toBeDefined();
    const post = await getPost(client, { url: selected!.url });
    expect(post.title.length).toBeGreaterThan(0);

    const comments = await getComments(client, { url: selected!.url, maxPages: 1 });
    expect(Array.isArray(comments)).toBe(true);
  }, 30_000);
});
