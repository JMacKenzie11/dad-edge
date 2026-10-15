import { describe, expect, it } from "vitest";
import {
  canonicalVimeoUrl,
  fetchVimeoMetadata,
  formatDuration,
  parseVimeoUrl,
  vimeoEmbedUrl,
} from "@/lib/resources/vimeo";
import {
  checkPdfFile,
  defaultDisplayName,
  downloadFileName,
  hasPdfSignature,
  storageSafeName,
} from "@/lib/resources/files";
import { slugify } from "@/lib/resources/slug";
import { adjacentLessons, courseProgress, nextUpLesson, sortCourses } from "@/lib/resources/progress";

describe("parseVimeoUrl", () => {
  it.each([
    ["https://vimeo.com/1084537", "1084537", null],
    ["https://vimeo.com/1084537/abc123def4", "1084537", "abc123def4"],
    ["https://player.vimeo.com/video/1084537?h=abc123def4&badge=0", "1084537", "abc123def4"],
    ["https://vimeo.com/channels/staffpicks/1084537", "1084537", null],
    ["https://vimeo.com/showcase/11112222/video/1084537", "1084537", null],
    ["https://vimeo.com/manage/videos/1084537/abc123def4", "1084537", "abc123def4"],
    ["https://vimeo.com/1084537?share=copy&h=abc123def4", "1084537", "abc123def4"],
    ["  https://www.vimeo.com/1084537  ", "1084537", null],
  ])("%s", (url, id, hash) => {
    expect(parseVimeoUrl(url)).toEqual({ videoId: id, hash });
  });

  it.each([
    "https://youtube.com/watch?v=1084537",
    "https://vimeo.com/about",
    "javascript:alert(1)",
    "not a url",
    "https://evil.com/vimeo.com/1084537",
    "https://vimeo.com.evil.com/1084537",
  ])("rejects %s", (url) => {
    expect(parseVimeoUrl(url)).toBeNull();
  });

  it("does not mistake a non-hex path segment for a privacy hash", () => {
    expect(parseVimeoUrl("https://vimeo.com/1084537/settings")).toEqual({ videoId: "1084537", hash: null });
  });
});

describe("vimeo urls", () => {
  it("carries the privacy hash into the player URL, or unlisted videos won't play", () => {
    expect(vimeoEmbedUrl("1084537", "abc123def4")).toContain("h=abc123def4");
    expect(vimeoEmbedUrl("1084537", null)).not.toContain("h=");
  });
  it("sends unlisted videos to oEmbed with the hash in the path", () => {
    expect(canonicalVimeoUrl("1084537", "abc123def4")).toBe("https://vimeo.com/1084537/abc123def4");
  });
  it("formats durations", () => {
    expect(formatDuration(597)).toBe("9:57");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("fetchVimeoMetadata", () => {
  it("maps an oEmbed response to what the lesson stores", async () => {
    const fakeFetch = (async (input: string) => {
      expect(input).toContain(encodeURIComponent("https://vimeo.com/1084537/abc123def4"));
      return new Response(
        JSON.stringify({ video_id: 1084537, thumbnail_url: "https://i.vimeocdn.com/video/1-d_960", duration: 597, title: "T" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const out = await fetchVimeoMetadata("https://vimeo.com/1084537/abc123def4", fakeFetch);
    expect(out).toEqual({
      videoId: "1084537",
      hash: "abc123def4",
      thumbnailUrl: "https://i.vimeocdn.com/video/1-d_960",
      durationSeconds: 597,
      title: "T",
    });
  });

  it("returns null when Vimeo says no (deleted, private, or embedding blocked)", async () => {
    const fakeFetch = (async () => new Response("Not found", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchVimeoMetadata("https://vimeo.com/1084537", fakeFetch)).toBeNull();
  });

  it("returns null without calling Vimeo for a link that isn't Vimeo", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await fetchVimeoMetadata("https://youtube.com/x", fakeFetch)).toBeNull();
    expect(called).toBe(false);
  });
});

describe("PDF checks", () => {
  it("accepts the %PDF- signature and nothing else", () => {
    expect(hasPdfSignature(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(hasPdfSignature(new TextEncoder().encode("<html>"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(hasPdfSignature(new Uint8Array([]))).toBe(false);
  });
  it("names files sensibly", () => {
    expect(defaultDisplayName("Patience_Workbook.pdf")).toBe("Patience Workbook");
    expect(storageSafeName("Week 1: Patience Workbook (final).PDF")).toBe("week-1-patience-workbook-final-.pdf");
    expect(downloadFileName("Week 1 / Notes")).toBe("Week 1 Notes.pdf");
    expect(downloadFileName("Notes.pdf")).toBe("Notes.pdf");
  });
});

describe("slugify", () => {
  it("makes a clean link name", () => {
    expect(slugify("Patience Course")).toBe("patience-course");
    expect(slugify("  Week 1: Fathers & Sons!  ")).toBe("week-1-fathers-and-sons");
    expect(slugify("Café Dads")).toBe("cafe-dads");
  });
});

describe("course progress", () => {
  const lessons = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("next up is the first incomplete lesson in order, not the last one touched", () => {
    expect(nextUpLesson(lessons, new Set(["a", "c"]))?.id).toBe("b");
    expect(nextUpLesson(lessons, new Set())?.id).toBe("a");
    expect(nextUpLesson(lessons, new Set(["a", "b", "c"]))).toBeNull();
  });
  it("counts progress", () => {
    expect(courseProgress(lessons, new Set(["a"]))).toMatchObject({ completed: 1, total: 3, percent: 33, started: true, finished: false });
    expect(courseProgress(lessons, new Set(["a", "b", "c"])).finished).toBe(true);
    expect(courseProgress([], new Set()).finished).toBe(false);
  });
  it("ignores completions for lessons no longer in the course", () => {
    expect(courseProgress(lessons, new Set(["gone"])).completed).toBe(0);
  });
  it("finds neighbors", () => {
    expect(adjacentLessons(lessons, "a")).toMatchObject({ prev: null, next: { id: "b" }, index: 0 });
    expect(adjacentLessons(lessons, "c")).toMatchObject({ prev: { id: "b" }, next: null, index: 2 });
  });
  it("sorts pinned courses first, then by sort order", () => {
    const sorted = sortCourses([
      { id: "1", is_pinned: false, sort_order: 0, created_at: "2026-01-01" },
      { id: "2", is_pinned: true, sort_order: 5, created_at: "2026-01-01" },
      { id: "3", is_pinned: false, sort_order: 1, created_at: "2026-01-01" },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["2", "1", "3"]);
  });
});

describe("checkPdfFile size limit", () => {
  const pdf = (bytes: number) => {
    const b = new Uint8Array(bytes);
    b.set(new TextEncoder().encode("%PDF-"));
    return new File([b], "workbook.pdf", { type: "application/pdf" });
  };

  it("accepts a 30 MB PDF", async () => {
    expect(await checkPdfFile(pdf(30 * 1024 * 1024))).toBeNull();
  });

  it("refuses a PDF over 50 MB with the size in the message", async () => {
    expect(await checkPdfFile(pdf(51 * 1024 * 1024))).toBe(
      "workbook.pdf is over 50 MB. Compress it or split it, then try again.",
    );
  });
});
