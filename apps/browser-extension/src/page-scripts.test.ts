import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clickPage, observePage, scrollPage, typePage } from "./page-scripts.js";

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM(
    `<!doctype html>
      <html>
        <head><title>Example account</title></head>
        <body>
          <label for="email">Email address</label>
          <input id="email" placeholder="name@example.com" />
          <button id="continue">Continue</button>
          <a href="/help">Help</a>
        </body>
      </html>`,
    { url: "https://app.example.com/login" },
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    InputEvent: dom.window.InputEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    location: dom.window.location,
    CSS: { escape: (value: string) => value.replaceAll('"', '\\"') },
  });
  for (const element of document.querySelectorAll<HTMLElement>("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({ width: 100, height: 24, top: 0, left: 0, right: 100, bottom: 24 }),
    });
    element.scrollIntoView = vi.fn();
  }
});

afterEach(() => {
  dom.window.close();
});

describe("browser extension page tools", () => {
  it("returns bounded text and stable observation refs", () => {
    const observation = observePage({
      observationId: "obs-1",
      maxElements: 10,
      maxTextChars: 500,
    });

    expect(observation.title).toBe("Example account");
    expect(observation.url).toBe("https://app.example.com/login");
    expect(observation.elements.map((element) => element.name)).toEqual([
      "Email address",
      "Continue",
      "Help",
    ]);
    expect(observation.elements[0]?.ref).toBe("e1");
    expect(document.getElementById("email")?.getAttribute("data-ericbot-ref")).toBe("obs-1:e1");
  });

  it("clicks and types only through refs from the current observation", () => {
    const clicked = vi.fn();
    document.getElementById("continue")?.addEventListener("click", clicked);
    observePage({ observationId: "obs-2", maxElements: 10, maxTextChars: 500 });

    clickPage({ observationId: "obs-2", ref: "e2" });
    typePage({
      observationId: "obs-2",
      ref: "e1",
      text: "user@example.com",
      clear: true,
      submit: false,
    });

    expect(clicked).toHaveBeenCalledOnce();
    expect((document.getElementById("email") as HTMLInputElement).value).toBe("user@example.com");
    expect(() => clickPage({ observationId: "old", ref: "e2" })).toThrow("observe again");
  });

  it("scrolls to a ref or by a page delta", () => {
    observePage({ observationId: "obs-3", maxElements: 10, maxTextChars: 500 });
    const scrollBy = vi.spyOn(dom.window, "scrollBy").mockImplementation(() => undefined);

    scrollPage({ observationId: "obs-3", ref: "e3", deltaY: 0 });
    scrollPage({ observationId: "obs-3", deltaY: 450 });

    expect(document.querySelector<HTMLElement>("a")?.scrollIntoView).toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledWith({ top: 450, left: 0, behavior: "auto" });
  });
});
