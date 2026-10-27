import { describe, expect, it } from "vitest";
import { addressNote, openingNote, usesAddressTerm, workNote } from "./address";

describe("usesAddressTerm", () => {
  it("spots brother, man, my man and his first name used to address him", () => {
    expect(usesAddressTerm("Hey brother, good to hear from you.", "Jason")).toBe(true);
    expect(usesAddressTerm("Tell me what's happening with Tanja, man.", "Jason")).toBe(true);
    expect(usesAddressTerm("Yeah, I hear this one all the time, man. What's an example?", "Jason")).toBe(true);
    expect(usesAddressTerm("Outstanding, my man.", "Jason")).toBe(true);
    expect(usesAddressTerm("What's going on, Jason?", "Jason")).toBe(true);
  });

  it("ignores man and brother when they aren't said to him", () => {
    expect(usesAddressTerm("The man changes first. She wants a man with standards.", "Jason")).toBe(false);
    expect(usesAddressTerm("Is this home, work, or everything at once?", null)).toBe(false);
  });
});

describe("addressNote", () => {
  it("first reply: his first name, no brother or man", () => {
    const note = addressNote("Jason", []);
    expect(note).toMatch(/Use his first name, Jason, once/);
    expect(note).toMatch(/Don't call him "brother" or "man"/);
  });

  it("first reply with no name on file: no brother or man either", () => {
    expect(addressNote(null, [])).toMatch(/Don't call him by name, "brother", "man" or "my man"/);
  });

  it("no address term while one of the last three replies had one", () => {
    const prior = ["What's going on, Jason?", "Tell me more.", "What did she say?"];
    expect(addressNote("Jason", prior)).toMatch(/Don't call him by name, "brother", "man" or "my man"/);
  });

  it("allows one, optionally, after three replies without", () => {
    const prior = ["What's going on, Jason?", "Tell me more.", "What did she say?", "How long has it been?"];
    expect(addressNote("Jason", prior)).toMatch(/You can call him Jason, "brother" or "man" once in this reply if it fits/);
  });
});

describe("workNote", () => {
  it("says work, not business, until he mentions a business", () => {
    expect(workNote(["I'm struggling man", "It's my relationship with my wife"])).toMatch(/Don't say "the business"/);
  });

  it("goes quiet once he's mentioned his business", () => {
    expect(workNote(["I'm struggling man", "The business is eating every evening"])).toBe("");
    expect(workNote(["My company lost its biggest client"])).toBe("");
  });
});

describe("openingNote", () => {
  it("first reply: no \"I hear you\"", () => {
    expect(openingNote([])).toMatch(/Don't say "I hear you"/);
  });

  it("nothing after the first reply", () => {
    expect(openingNote(["What's going on, Jason?"])).toBe("");
  });
});
