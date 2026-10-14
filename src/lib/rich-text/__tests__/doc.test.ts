import { describe, expect, it } from "vitest";
import { isEmptyDoc, plainText, safeHref, sanitizeDoc } from "@/lib/rich-text/doc";

describe("safeHref", () => {
  it.each(["https://thedadedge.com", "http://example.com/a?b=c"])("allows %s", (u) => {
    expect(safeHref(u)).not.toBeNull();
  });
  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hi", "mailto:x@y.z", "/relative", "", "  "])(
    "refuses %s",
    (u) => {
      expect(safeHref(u)).toBeNull();
    },
  );
});

describe("sanitizeDoc", () => {
  it("keeps the allowed set intact", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Week one" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Be ", marks: [{ type: "bold" }] },
            { type: "text", text: "patient", marks: [{ type: "italic" }, { type: "link", attrs: { href: "https://x.com" } }] },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] }] },
      ],
    };
    expect(sanitizeDoc(doc)).toEqual(doc);
  });

  it("drops javascript links but keeps the words", () => {
    const out = sanitizeDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    });
    expect(out).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "click" }] }] });
  });

  it("turns disallowed blocks into plain paragraphs and drops images", () => {
    const out = sanitizeDoc({
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "rm -rf" }] },
        { type: "image", attrs: { src: "https://x/y.png" } },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Big" }] },
      ],
    });
    expect(out).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "rm -rf" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Big" }] },
      ],
    });
  });

  it("drops unknown marks", () => {
    const out = sanitizeDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "highlight" }, { type: "bold" }] }] }],
    });
    expect(out?.content[0]).toEqual({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] });
  });

  it("returns null for empty or garbage input", () => {
    expect(sanitizeDoc("")).toBeNull();
    expect(sanitizeDoc("{not json")).toBeNull();
    expect(sanitizeDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBeNull();
    expect(sanitizeDoc({ type: "nope" })).toBeNull();
    expect(sanitizeDoc(null)).toBeNull();
  });

  it("accepts the JSON string the editor posts", () => {
    const json = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] });
    expect(plainText(sanitizeDoc(json))).toBe("hi");
    expect(isEmptyDoc(sanitizeDoc(json))).toBe(false);
  });
});
