import { randomUUID } from "node:crypto";
import type {
  LocalComputerAction,
  LocalComputerObservation,
  LocalComputerProvider,
} from "@rakazo/local-runtime";
import { launchLocalApplication } from "./local-desktop-actions.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function keyName(raw: string): string {
  const value = raw.trim();
  const normalized = value.toLowerCase();
  const aliases: Record<string, string> = {
    cmd: "LeftCmd",
    command: "LeftCmd",
    meta: "LeftMeta",
    ctrl: "LeftControl",
    control: "LeftControl",
    alt: "LeftAlt",
    option: "LeftAlt",
    shift: "LeftShift",
    enter: "Enter",
    return: "Return",
    escape: "Escape",
    esc: "Escape",
    tab: "Tab",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
  };
  if (aliases[normalized]) return aliases[normalized]!;
  if (/^[a-z]$/i.test(value)) return value.toUpperCase();
  if (/^[0-9]$/.test(value)) return `Num${value}`;
  return value;
}

async function keyCode(Key: Record<string, unknown>, raw: string): Promise<number> {
  const name = keyName(raw);
  const value = Key[name];
  if (typeof value !== "number") throw new Error(`Unsupported key: ${raw}`);
  return value;
}

export function createLocalComputerProvider(): LocalComputerProvider {
  async function observe(signal?: AbortSignal): Promise<LocalComputerObservation> {
    signal?.throwIfAborted();
    const [{ screen, mouse, getActiveWindow }, { default: sharp }] = await Promise.all([
      import("@nut-tree-fork/nut-js"),
      import("sharp"),
    ]);
    const image = await screen.grab();
    signal?.throwIfAborted();
    const rgb = await image.toRGB();
    const imageBytes = await sharp(rgb.data, {
      raw: {
        width: rgb.width,
        height: rgb.height,
        channels: rgb.channels as 1 | 2 | 3 | 4,
      },
    })
      .jpeg({ quality: 80, chromaSubsampling: "4:2:0" })
      .toBuffer();
    const cursor = await mouse
      .getPosition()
      .then((point) => ({ x: point.x, y: point.y }))
      .catch(() => undefined);
    const active = await getActiveWindow()
      .then(async (window) => {
        const title = await window.getTitle();
        return { id: title, ...(title ? { title } : {}) };
      })
      .catch(() => undefined);
    return {
      frameId: randomUUID(),
      capturedAt: new Date().toISOString(),
      width: rgb.width,
      height: rgb.height,
      mimeType: "image/jpeg",
      image: imageBytes,
      ...(cursor ? { cursor } : {}),
      ...(active ? { activeWindow: active } : {}),
    };
  }

  async function act(input: {
    actions: LocalComputerAction[];
    observe: boolean;
    settleMs: number;
    signal?: AbortSignal;
  }) {
    const { Button, Key, keyboard, mouse } = await import("@nut-tree-fork/nut-js");
    let completed = 0;
    for (const action of input.actions) {
      input.signal?.throwIfAborted();
      if (action.kind === "pointer") {
        await mouse.setPosition({ x: action.x, y: action.y });
        const button = action.button === "right" ? Button.RIGHT : Button.LEFT;
        if (action.type === "click") await mouse.click(button);
        if (action.type === "down") await mouse.pressButton(button);
        if (action.type === "up") await mouse.releaseButton(button);
      } else if (action.kind === "clipboard") {
        if (action.text) await keyboard.type(action.text);
      } else if (action.kind === "key") {
        const keys: number[] = [];
        for (const modifier of action.modifiers ?? []) {
          keys.push(await keyCode(Key as unknown as Record<string, unknown>, modifier));
        }
        keys.push(await keyCode(Key as unknown as Record<string, unknown>, action.key));
        await keyboard.pressKey(...(keys as never[]));
        await keyboard.releaseKey(...(keys as never[]));
      } else if (action.kind === "scroll") {
        if (action.direction === "up") await mouse.scrollUp(action.amount);
        else await mouse.scrollDown(action.amount);
      } else if (action.kind === "wait") {
        await sleep(action.ms);
      } else {
        await launchLocalApplication(action.application, action.uri);
      }
      completed += 1;
    }
    if (input.settleMs > 0) await sleep(input.settleMs);
    return {
      completed,
      ...(input.observe ? { observation: await observe(input.signal) } : {}),
    };
  }

  return { observe, act };
}
