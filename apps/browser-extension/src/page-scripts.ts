export interface ObservePageInput {
  observationId: string;
  maxElements: number;
  maxTextChars: number;
}

export interface RefPageInput {
  observationId: string;
  ref: string;
}

export interface TypePageInput extends RefPageInput {
  text: string;
  clear: boolean;
  submit: boolean;
}

export interface ScrollPageInput {
  observationId: string;
  ref?: string;
  deltaY: number;
}

export function observePage(input: ObservePageInput) {
  for (const element of document.querySelectorAll("[data-ericbot-ref]")) {
    element.removeAttribute("data-ericbot-ref");
  }

  const elementLimit = Math.max(1, Math.min(300, Math.trunc(input.maxElements)));
  const textLimit = Math.max(500, Math.min(30_000, Math.trunc(input.maxTextChars)));
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "textarea",
        "select",
        "summary",
        "[contenteditable=true]",
        "[role=button]",
        "[role=link]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=tab]",
        "[role=menuitem]",
      ].join(","),
    ),
  );

  function visible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function compact(value: string | null | undefined, limit = 200): string {
    return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function labelFor(element: HTMLElement): string {
    const aria = compact(element.getAttribute("aria-label"));
    if (aria) return aria;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const labels = Array.from(element.labels ?? [])
        .map((label) => compact(label.innerText || label.textContent))
        .filter(Boolean);
      if (labels.length > 0) return labels.join(" / ");
      const placeholder = compact(element.placeholder);
      if (placeholder) return placeholder;
    }
    const title = compact(element.getAttribute("title"));
    if (title) return title;
    const alt = compact(element.getAttribute("alt"));
    if (alt) return alt;
    return compact(element.innerText || element.textContent || element.getAttribute("name"));
  }

  function roleFor(element: HTMLElement): string {
    const explicit = compact(element.getAttribute("role"), 80);
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "summary") return "button";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (element.type === "submit" || element.type === "button") return "button";
      return "textbox";
    }
    return tag;
  }

  const elements: Array<{
    ref: string;
    role: string;
    name: string;
    tag: string;
    disabled: boolean;
    type?: string;
    checked?: boolean;
  }> = [];
  let truncated = candidates.length > elementLimit;
  for (const element of candidates) {
    if (!visible(element)) continue;
    if (elements.length >= elementLimit) {
      truncated = true;
      break;
    }
    const ref: string = `e${elements.length + 1}`;
    element.setAttribute("data-ericbot-ref", `${input.observationId}:${ref}`);
    const inputElement =
      element instanceof HTMLInputElement
        ? {
            ...(element.type ? { type: element.type } : {}),
            ...(["checkbox", "radio"].includes(element.type) ? { checked: element.checked } : {}),
          }
        : {};
    elements.push({
      ref,
      role: roleFor(element),
      name: labelFor(element),
      tag: element.tagName.toLowerCase(),
      disabled:
        element.getAttribute("aria-disabled") === "true" ||
        (element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? element.disabled
          : false),
      ...inputElement,
    });
  }

  const fullText = compact(document.body?.innerText, textLimit + 1);
  if (fullText.length > textLimit) truncated = true;
  return {
    title: document.title,
    url: location.href,
    text: fullText.slice(0, textLimit),
    elements,
    truncated,
  };
}

export function clickPage(input: RefPageInput) {
  const ref = input.ref.match(/^e\d+$/)?.[0];
  if (!ref) throw new Error("ref must look like e1");
  const selector = `[data-ericbot-ref="${CSS.escape(`${input.observationId}:${ref}`)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error("Element is no longer on the page; observe again");
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  element.click();
  return {
    title: document.title,
    url: location.href,
    tag: element.tagName.toLowerCase(),
  };
}

export function typePage(input: TypePageInput) {
  const ref = input.ref.match(/^e\d+$/)?.[0];
  if (!ref) throw new Error("ref must look like e1");
  const selector = `[data-ericbot-ref="${CSS.escape(`${input.observationId}:${ref}`)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error("Element is no longer on the page; observe again");
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element.isContentEditable
    )
  ) {
    throw new Error("Target is not a text input");
  }
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.disabled
  ) {
    throw new Error("Target input is disabled");
  }
  element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element instanceof HTMLInputElement && element.type === "file") {
      throw new Error("File inputs are not supported by browser_type");
    }
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const value = input.clear === false ? `${element.value}${input.text}` : input.text;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    element.textContent = input.text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }
  if (input.submit) {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  return { title: document.title, url: location.href, tag: element.tagName.toLowerCase() };
}

export function scrollPage(input: ScrollPageInput) {
  if (input.ref) {
    const ref = input.ref.match(/^e\d+$/)?.[0];
    if (!ref) throw new Error("ref must look like e1");
    const selector = `[data-ericbot-ref="${CSS.escape(`${input.observationId}:${ref}`)}"]`;
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error("Element is no longer on the page; observe again");
    element.scrollIntoView({ block: "center", inline: "nearest" });
  } else {
    window.scrollBy({ top: input.deltaY, left: 0, behavior: "auto" });
  }
  return { title: document.title, url: location.href };
}
