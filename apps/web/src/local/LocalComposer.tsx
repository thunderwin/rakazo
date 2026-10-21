import { Trans, useLingui } from "@lingui/react/macro";
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  attachmentSizeLabel,
  isAttachmentImageMimeType,
} from "@rakazo/contracts";
import type { ComposerMention } from "@rakazo/core";
import {
  buildComposerMentionOptions,
  clampMentionHighlightIndex,
  inferAttachmentMimeType,
  mentionChipKey,
  resolveMentionPickerKey,
} from "@rakazo/core";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { ArrowUp, AtSign, FileText, Paperclip, Square, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isFileDrag } from "../lib/pending-attachments";
import type { LocalBot } from "./types";

export interface ComposerAttachment {
  id: string;
  file: File;
  mimeType: string;
  previewUrl?: string;
}

function trailingMention(value: string): string | null {
  const match = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(value);
  return match ? (match[1] ?? "") : null;
}

export function LocalComposer({
  bots,
  activeBotName,
  includeEveryone = false,
  running,
  enterToSend,
  onSend,
  onStop,
}: {
  bots: readonly LocalBot[];
  activeBotName: string;
  includeEveryone?: boolean;
  running: boolean;
  enterToSend: boolean;
  onSend: (text: string, attachments: readonly ComposerAttachment[]) => Promise<boolean>;
  onStop: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [notice, setNotice] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    },
    [],
  );

  const options = useMemo(
    () =>
      mentionQuery === null
        ? []
        : buildComposerMentionOptions({
            query: mentionQuery,
            bots: bots.map((bot) => ({ id: bot.id, name: bot.name, color: bot.color })),
            groups: [],
            routines: [],
            connectors: [],
            includeEveryone,
            limit: 7,
          }),
    [bots, includeEveryone, mentionQuery],
  );
  const activeIndex = clampMentionHighlightIndex(highlight, options.length);
  const pickerOpen = options.length > 0;

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft]);

  useEffect(() => {
    setHighlight(0);
  }, [mentionQuery]);

  function updateDraft(value: string) {
    setDraft(value);
    setMentionQuery(composing ? null : trailingMention(value));
  }

  function focusWithDraft(value: string) {
    setDraft(value);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(value.length, value.length);
    });
  }

  function insertMention(mention: ComposerMention) {
    const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(draft);
    const index = match?.index ?? draft.length;
    const prefix = match?.[1] ?? "";
    focusWithDraft(`${draft.slice(0, index)}${prefix}`.replace(/\s+$/, " "));
    setMentions((current) =>
      current.some((item) => mentionChipKey(item) === mentionChipKey(mention))
        ? current
        : [...current, mention],
    );
    setMentionQuery(null);
  }

  function removeMention(mention: ComposerMention) {
    setMentions((current) =>
      current.filter((item) => mentionChipKey(item) !== mentionChipKey(mention)),
    );
  }

  async function submit() {
    const body = draft.trim();
    const mentionText = mentions.map((mention) => `@${mention.name}`).join(" ");
    const text = [mentionText, body].filter(Boolean).join(" ");
    if ((!text && attachments.length === 0) || running || sending) return;
    setSending(true);
    try {
      if (await onSend(text, attachments)) {
        for (const attachment of attachments) {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        }
        setDraft("");
        setMentions([]);
        setMentionQuery(null);
        setAttachments([]);
        setNotice("");
      }
    } finally {
      setSending(false);
      requestAnimationFrame(() => textarea.current?.focus());
    }
  }

  function addFiles(files: readonly File[]) {
    const skipped: string[] = [];
    const next: ComposerAttachment[] = [];
    for (const file of files) {
      if (attachments.length + next.length >= ATTACHMENT_MAX_COUNT) {
        skipped.push(t`${file.name} (max ${ATTACHMENT_MAX_COUNT} files)`);
        continue;
      }
      const mimeType = inferAttachmentMimeType(file.name, file.type);
      if (!mimeType) {
        skipped.push(t`${file.name} (unsupported type)`);
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        skipped.push(t`${file.name} (over ${attachmentSizeLabel(ATTACHMENT_MAX_BYTES)})`);
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        mimeType,
        ...(isAttachmentImageMimeType(mimeType) ? { previewUrl: URL.createObjectURL(file) } : {}),
      });
    }
    if (next.length) setAttachments((current) => [...current, ...next]);
    setNotice(skipped.length ? t`Skipped ${skipped.join(", ")}` : "");
  }

  function removeAttachment(attachment: ComposerAttachment) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    setNotice("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Backspace" && draft.length === 0 && mentions.length > 0 && !composing) {
      event.preventDefault();
      setMentions((current) => current.slice(0, -1));
      return;
    }
    const action = resolveMentionPickerKey({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      isComposing: composing || event.nativeEvent.isComposing,
      optionCount: options.length,
      highlightedIndex: activeIndex,
      enterToSend,
    });
    if (action.type === "move") {
      event.preventDefault();
      setHighlight(action.index);
      return;
    }
    if (action.type === "complete") {
      event.preventDefault();
      const mention = options[action.index];
      if (mention) insertMention(mention);
      return;
    }
    if (action.type === "dismiss") {
      event.preventDefault();
      setMentionQuery(null);
      return;
    }
    if (action.type === "send") {
      event.preventDefault();
      void submit();
    }
  }

  const canSend = Boolean(draft.trim() || mentions.length || attachments.length);

  return (
    <fieldset
      aria-label={t`Message composer`}
      className="relative m-0 min-w-0 border-0 px-4 pb-4 pt-2 sm:px-6"
      onDragOver={(event) => {
        if (isFileDrag(event.dataTransfer)) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {pickerOpen ? (
        <div
          id="local-mention-picker"
          role="listbox"
          aria-label={t`Mentions`}
          className="absolute inset-x-4 bottom-[calc(100%-2px)] z-20 overflow-hidden rounded-[16px] border border-border bg-popover p-1 shadow-2xl sm:inset-x-6"
        >
          {options.map((mention, index) => {
            const bot = bots.find((candidate) => candidate.id === mention.id);
            const highlighted = index === activeIndex;
            return (
              <button
                key={mentionChipKey(mention)}
                id={`local-mention-option-${index}`}
                type="button"
                role="option"
                aria-selected={highlighted}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start outline-none ${
                  highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setHighlight(index)}
                onClick={() => insertMention(mention)}
              >
                {bot ? (
                  <BotAvatar color={bot.color} identity={bot.id} size={24} />
                ) : (
                  <span className="grid size-6 place-items-center rounded-full bg-accent text-[10px]">
                    @
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">@{mention.name}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {bot?.description || t`Bot`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-[24px] border border-border bg-card shadow-[0_10px_35px_rgba(0,0,0,0.12)] transition-colors focus-within:border-ring/70">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          accept={ATTACHMENT_ALLOWED_MIME_TYPES.join(",")}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        {attachments.length ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-border bg-muted/45 px-2 py-1 text-[12px]"
              >
                {attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt=""
                    className="size-6 rounded-md object-cover"
                  />
                ) : (
                  <FileText size={14} className="text-muted-foreground" />
                )}
                <span className="max-w-52 truncate">{attachment.file.name}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                  aria-label={t`Remove ${attachment.file.name}`}
                  disabled={running || sending}
                  onClick={() => removeAttachment(attachment)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {mentions.length ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {mentions.map((mention) => {
              const bot = bots.find((candidate) => candidate.id === mention.id);
              return (
                <span
                  key={mentionChipKey(mention)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2 py-1 text-[12.5px]"
                >
                  {bot ? (
                    <BotAvatar color={bot.color} identity={bot.id} size={16} />
                  ) : (
                    <span className="grid size-4 place-items-center rounded-full bg-background/70 text-[9px]">
                      @
                    </span>
                  )}
                  <span className="truncate">{mention.name}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                    aria-label={t`Remove mention ${mention.name}`}
                    onClick={() => removeMention(mention)}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="flex items-end gap-2 p-2.5">
          <button
            type="button"
            className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground"
            aria-label={t`Attach files`}
            disabled={running || sending}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={15} />
          </button>
          <button
            type="button"
            className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground"
            aria-label={t`Mention a bot`}
            disabled={running || sending || bots.length === 0}
            onClick={() => {
              const next = draft ? `${draft} @` : "@";
              focusWithDraft(next);
              setMentionQuery("");
            }}
          >
            <AtSign size={15} />
          </button>
          <textarea
            ref={textarea}
            value={draft}
            rows={1}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? "local-mention-picker" : undefined}
            aria-activedescendant={pickerOpen ? `local-mention-option-${activeIndex}` : undefined}
            aria-label={t`Message ${activeBotName}`}
            placeholder={t`Message ${activeBotName}`}
            autoComplete="off"
            disabled={running}
            className="min-h-8 max-h-42 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1.5 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            onChange={(event) => updateDraft(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length) {
                event.preventDefault();
                addFiles(files);
              }
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setMentionQuery(trailingMention(event.currentTarget.value));
            }}
            onKeyDown={onKeyDown}
          />
          {running ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="mb-0.5 rounded-full"
              aria-label={t`Stop`}
              onClick={() => void onStop()}
            >
              <Square size={14} fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="mb-0.5 rounded-full"
              aria-label={t`Send`}
              disabled={!canSend || sending}
              onClick={() => void submit()}
            >
              <ArrowUp size={16} />
            </Button>
          )}
        </div>
      </div>
      {notice ? <p className="mt-1 text-center text-[10.5px] text-destructive">{notice}</p> : null}
      <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground/75">
        {enterToSend ? (
          <Trans>Enter to send · Shift+Enter for a new line</Trans>
        ) : (
          <Trans>⌘/Ctrl+Enter to send</Trans>
        )}
      </p>
    </fieldset>
  );
}
