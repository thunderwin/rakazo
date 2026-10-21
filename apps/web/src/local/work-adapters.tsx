import type {
  DesktopLocalArtifact,
  DesktopLocalTicket,
  DesktopLocalTicketComment,
  Ticket,
  TicketComment,
} from "@rakazo/contracts";
import { useMemo, useState } from "react";
import { ArtifactsPage, type ArtifactsDataSource } from "../pages/Artifacts";
import { type BoardDataSource, BoardPage } from "../pages/Board";
import {
  ScratchpadSection,
  type ScratchpadDataSource,
} from "../pages/ScratchpadSection";
import type { LocalBridge } from "./types";

function localTicket(ticket: DesktopLocalTicket): Ticket {
  return {
    id: ticket.id,
    boardId: "local",
    spaceId: "local",
    number: ticket.sequence,
    ref: ticket.reference,
    title: ticket.title,
    description: ticket.description || null,
    status: ticket.status,
    priority: ticket.priority,
    assigneeBotId: ticket.ownerBotId,
    createdByBotId: ticket.botId,
    createdByUserId: null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    completedAt:
      ticket.status === "done" || ticket.status === "closed"
        ? ticket.updatedAt
        : null,
  };
}

function localArtifact<T extends DesktopLocalArtifact>(artifact: T) {
  return {
    ...artifact,
    runId: null,
    description: null,
    version: 1,
    versionCount: 1,
  };
}

function localComment(
  comment: DesktopLocalTicketComment,
  botName: (botId: string) => string | undefined,
): TicketComment {
  return {
    id: comment.id,
    ticketId: comment.ticketId,
    body: comment.body,
    authorBotId: comment.botId,
    authorUserId: null,
    authorName: botName(comment.botId) ?? null,
    createdAt: comment.createdAt,
    updatedAt: comment.createdAt,
  };
}

export function LocalScratchpadSection({
  api,
  botId,
}: {
  api: LocalBridge;
  botId: string;
}) {
  const source = useMemo<ScratchpadDataSource>(
    () => ({
      list: (id) => api.scratchpad.list(id),
      create: (id, title) => api.scratchpad.create(id, { title }),
      update: (itemId, status) =>
        api.scratchpad.update(botId, itemId, {
          status,
        }),
      remove: (itemId) => api.scratchpad.remove(botId, itemId),
    }),
    [api, botId],
  );
  return <ScratchpadSection botId={botId} source={source} />;
}

export function LocalBoardPage({
  api,
  onBack,
}: {
  api: LocalBridge;
  onBack: () => void;
}) {
  const source = useMemo<BoardDataSource>(() => {
    const ownerNames = new Map<string, string>();
    return {
      listOwners: async () => {
        const bots = await api.bots.list();
        ownerNames.clear();
        for (const bot of bots) ownerNames.set(bot.id, bot.name);
        return bots.map(({ id, name }) => ({ id, name }));
      },
      listTickets: async () =>
        (await api.tickets.list()).map((ticket) => localTicket(ticket)),
      createTicket: async (input) =>
        localTicket(
          await api.tickets.create({
            botId: input.assigneeBotId,
            ownerBotId: input.assigneeBotId,
            title: input.title,
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
            priority: input.priority,
          }),
        ),
      updateTicket: async (input) =>
        localTicket(
          await api.tickets.update(input.id, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.description === undefined || input.description === null
              ? {}
              : { description: input.description }),
            ...(input.assigneeBotId === undefined
              ? {}
              : { ownerBotId: input.assigneeBotId }),
            ...(input.status === undefined ? {} : { status: input.status }),
            ...(input.priority === undefined
              ? {}
              : { priority: input.priority }),
          }),
        ),
      comments: async (ticketId) =>
        (await api.tickets.comments(ticketId)).map((comment) =>
          localComment(comment, (botId) => ownerNames.get(botId)),
        ),
      comment: async (ticketId, body, authorBotId) => {
        if (!authorBotId)
          throw new Error("Choose a ticket owner before commenting");
        return localComment(
          await api.tickets.comment(ticketId, authorBotId, body),
          (botId) => ownerNames.get(botId),
        );
      },
    };
  }, [api]);

  return (
    <BoardPage
      source={source}
      showWindowChrome={false}
      embedded
      onBack={onBack}
    />
  );
}

export function LocalArtifactsPage({
  api,
  onBack,
}: {
  api: LocalBridge;
  onBack: () => void;
}) {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  );
  const source = useMemo<ArtifactsDataSource>(
    () => ({
      listBots: async () =>
        (await api.bots.list()).map(({ id, name, color }) => ({
          id,
          name,
          color,
        })),
      list: async (input) => {
        const page = await api.artifacts.list(input);
        return {
          items: page.items.map(localArtifact),
          nextCursor: page.nextCursor,
        };
      },
      listVersions: async (familyId) => {
        const artifact = (await api.artifacts.list({ limit: 200 })).items.find(
          (item) => item.id === familyId,
        );
        return artifact
          ? [
              {
                id: artifact.id,
                version: 1,
                name: artifact.name,
                createdAt: artifact.createdAt,
              },
            ]
          : [];
      },
      get: async (artifactId) => {
        const artifact = await api.artifacts.read(artifactId);
        if (!artifact) throw new Error("Artifact not found");
        return localArtifact(artifact);
      },
      remove: (artifactId) => api.artifacts.remove(artifactId),
    }),
    [api],
  );

  return (
    <ArtifactsPage
      source={source}
      selectedArtifactId={selectedArtifactId ?? undefined}
      onSelectArtifact={setSelectedArtifactId}
      onBack={onBack}
      showWindowChrome={false}
    />
  );
}
