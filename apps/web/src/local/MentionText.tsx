import { resolvePersonaColorDef } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import type { LocalBot } from "./types";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function MentionText({ text, bots }: { text: string; bots: readonly LocalBot[] }) {
  const names = bots
    .map((bot) => bot.name.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) return text;

  const byName = new Map(bots.map((bot) => [bot.name.trim().toLocaleLowerCase(), bot]));
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_-])(@(?:${names.map(escapeRegExp).join("|")}))(?=$|[^\\p{L}\\p{N}_-])`,
    "giu",
  );
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const prefix = match[1] ?? "";
    const token = match[2] ?? "";
    const name = token.slice(1);
    const bot = byName.get(name.toLocaleLowerCase());
    if (!bot) continue;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    if (prefix) nodes.push(prefix);
    const color = resolvePersonaColorDef(bot.id, bot.color).hex;
    nodes.push(
      <span
        key={`${index}:${bot.id}`}
        className="mx-0.5 inline-flex items-baseline rounded-full border px-1.5 py-0.5 text-[0.92em] font-medium"
        style={{
          borderColor: `color-mix(in srgb, ${color} 45%, var(--border))`,
          backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        }}
      >
        {token}
      </span>,
    );
    cursor = index + match[0].length;
  }
  if (cursor === 0) return text;
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
