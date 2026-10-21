import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { BotAvatar } from "@rakazo/ui-web";
import { AlertTriangle, ArrowRight, Check, LoaderCircle, Wrench } from "lucide-react";
import { LocalAttachmentView } from "./LocalAttachmentView";
import { MentionText } from "./MentionText";
import {
  type LocalBot,
  type LocalBridge,
  type LocalGroupMessage,
  type LocalMessage,
  type LocalMessageBlock,
  messageBlocks,
  messageText,
} from "./types";

function timeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function LocalMessageView({
  message,
  bot,
  bots,
  api,
}: {
  message: LocalMessage | LocalGroupMessage;
  bot?: LocalBot;
  bots: readonly LocalBot[];
  api: LocalBridge;
}) {
  const blocks = messageBlocks(message);
  const text = messageText(message);
  const errors = blocks.filter(
    (block): block is { kind: "error"; message: string } =>
      block.kind === "error" && typeof block.message === "string",
  );
  const tools = blocks.filter(
    (block): block is { kind: "tool_call"; name: string } =>
      block.kind === "tool_call" && typeof block.name === "string",
  );
  const handoffs = blocks.filter(
    (block): block is Extract<LocalMessageBlock, { kind: "handoff" }> =>
      block.kind === "handoff" &&
      typeof block.fromBotId === "string" &&
      typeof block.toBotId === "string" &&
      typeof block.text === "string" &&
      typeof block.hop === "number",
  );
  const attachments = blocks.filter(
    (block): block is Extract<LocalMessageBlock, { kind: "image" | "file" }> => {
      if (block.kind !== "image" && block.kind !== "file") return false;
      if (!("artifactId" in block) || !("name" in block) || !("mimeType" in block)) return false;
      if (typeof block.artifactId !== "string" || typeof block.name !== "string") return false;
      if (block.kind === "image") return typeof block.mimeType === "string";
      if (block.kind === "file") {
        return typeof block.mimeType === "string" && typeof block.size === "number";
      }
      return false;
    },
  );
  const user = message.role === "user";

  return (
    <article
      className={`group flex w-full gap-3 ${user ? "justify-end" : "justify-start"}`}
      data-message-role={message.role}
    >
      {!user && bot ? <BotAvatar color={bot.color} identity={bot.id} size={30} /> : null}
      <div className={`min-w-0 ${user ? "max-w-[78%]" : "max-w-[min(760px,84%)]"}`}>
        <div
          className={`mb-1.5 flex items-center gap-2 text-[12px] ${
            user ? "justify-end" : "justify-start"
          }`}
        >
          <span className="font-medium text-foreground/80">
            {user ? "You" : (bot?.name ?? "Bot")}
          </span>
          <time className="text-muted-foreground" dateTime={message.createdAt}>
            {timeLabel(message.createdAt)}
          </time>
        </div>
        <div
          className={
            user
              ? "rounded-[18px] rounded-br-md bg-chat-user px-4 py-2.5 text-[15px] leading-6 text-chat-user-foreground"
              : "px-1 py-0.5 text-[15px] leading-6 text-foreground"
          }
        >
          {attachments.map((attachment) => (
            <LocalAttachmentView
              key={`${attachment.kind}:${attachment.artifactId}`}
              block={attachment}
              api={api}
            />
          ))}
          {text ? (
            <div className={attachments.length ? "mt-2" : undefined}>
              {user ? (
                <div className="whitespace-pre-wrap break-words">
                  <MentionText text={text} bots={bots} />
                </div>
              ) : (
                <ChatMarkdown>{text}</ChatMarkdown>
              )}
            </div>
          ) : null}
        </div>

        {tools.length > 0 ? (
          <details className="group/tools mt-2 w-fit max-w-full">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <Check size={13} aria-hidden="true" />
              {tools.length === 1 ? "1 tool action" : `${tools.length} tool actions`}
            </summary>
            <div className="mt-1 space-y-1 border-s border-border ps-3">
              {tools.map((tool, index) => (
                <div
                  key={`${tool.name}:${index}`}
                  className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
                >
                  <Wrench size={12} aria-hidden="true" />
                  <span className="font-mono">{tool.name}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {handoffs.map((handoff, index) => {
          const from = bots.find((candidate) => candidate.id === handoff.fromBotId);
          const to = bots.find((candidate) => candidate.id === handoff.toBotId);
          return (
            <div
              key={`handoff:${index}`}
              className="mt-2 rounded-xl border border-border bg-muted/45 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 text-[12.5px] font-medium">
                <span>{from?.name ?? "Bot"}</span>
                <ArrowRight size={13} className="text-muted-foreground" aria-hidden="true" />
                <span>{to?.name ?? "Bot"}</span>
                <span className="ml-auto text-[10.5px] font-normal text-muted-foreground">
                  hop {handoff.hop}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-muted-foreground">
                {handoff.text}
              </p>
            </div>
          );
        })}

        {errors.map((error, index) => {
          const stopped = error.message === "Run stopped.";
          return (
            <div
              key={`error:${index}`}
              className={`mt-2 rounded-xl border px-3 py-2.5 ${
                stopped
                  ? "border-border bg-muted/45 text-muted-foreground"
                  : "border-destructive/30 bg-destructive/10 text-foreground"
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={15}
                  className={stopped ? "mt-0.5 text-muted-foreground" : "mt-0.5 text-destructive"}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="m-0 text-[13px] font-medium">
                    {stopped ? "Run stopped" : "This run did not finish"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{error.message}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function LocalLiveMessage({
  bot,
  text,
  status,
}: {
  bot?: LocalBot;
  text: string;
  status: string;
}) {
  return (
    <article className="flex w-full justify-start gap-3" data-message-role="live">
      {bot ? <BotAvatar color={bot.color} identity={bot.id} size={30} status="running" /> : null}
      <div className="min-w-0 max-w-[min(760px,84%)]">
        <div className="mb-1.5 flex items-center gap-2 text-[12px]">
          <span className="font-medium text-foreground/80">{bot?.name ?? "Bot"}</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            {status || "Working"}
          </span>
        </div>
        <div className="px-1 py-0.5 text-[15px] leading-6 text-foreground">
          {text ? <ChatMarkdown streaming>{text}</ChatMarkdown> : null}
          {!text ? (
            <div className="flex items-center gap-1 py-1" role="status" aria-label="Thinking">
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:120ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:240ms]" />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
