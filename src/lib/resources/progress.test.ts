import { describe, expect, it } from "vitest";
import { adjacentLessons, groupLessonsBySection, orderLessons } from "./progress";

const sections = [
  { id: "part1", sort_order: 1, title: "Part 1" },
  { id: "intro", sort_order: 0, title: "Course Introduction" },
  { id: "empty", sort_order: 2, title: "Coming soon" },
];
// sort_order restarts inside each section, so sort_order alone would
// interleave the two sections.
const lessons = [
  { id: "voice", section_id: "part1", sort_order: 0 },
  { id: "welcome", section_id: "intro", sort_order: 0 },
  { id: "mirror", section_id: "part1", sort_order: 1 },
  { id: "outline", section_id: "intro", sort_order: 1 },
];

describe("orderLessons", () => {
  it("walks sections in order, then lessons inside each", () => {
    expect(orderLessons(lessons, sections).map((l) => l.id)).toEqual(["welcome", "outline", "voice", "mirror"]);
  });

  it("leaves a flat course in sort_order", () => {
    const flat = [
      { id: "b", section_id: null, sort_order: 1 },
      { id: "a", section_id: null, sort_order: 0 },
    ];
    expect(orderLessons(flat, []).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("puts a lesson without a known section last instead of dropping it", () => {
    const withLoose = [...lessons, { id: "loose", section_id: null, sort_order: 0 }];
    expect(orderLessons(withLoose, sections).map((l) => l.id)).toEqual(["welcome", "outline", "voice", "mirror", "loose"]);
  });

  it("drives previous/next (and the lesson page's Next up) across a section boundary", () => {
    const ordered = orderLessons(lessons, sections);
    const { prev, next } = adjacentLessons(ordered, "voice");
    expect(prev?.id).toBe("outline");
    expect(next?.id).toBe("mirror");
  });
});

describe("groupLessonsBySection", () => {
  it("groups in section order and keeps empty sections", () => {
    const groups = groupLessonsBySection(sections, lessons);
    expect(groups.map((g) => [g.section?.title, g.lessons.map((l) => l.id)])).toEqual([
      ["Course Introduction", ["welcome", "outline"]],
      ["Part 1", ["voice", "mirror"]],
      ["Coming soon", []],
    ]);
  });

  it("adds a trailing group for lessons outside any section", () => {
    const groups = groupLessonsBySection(sections, [...lessons, { id: "loose", section_id: "gone", sort_order: 0 }]);
    expect(groups.at(-1)).toEqual({ section: null, lessons: [{ id: "loose", section_id: "gone", sort_order: 0 }] });
  });
});
