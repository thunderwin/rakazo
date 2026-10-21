import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import { LocalRoutineRuntime } from "./routines.js";

describe("local routines", () => {
  it("runs the latest missed occurrence once and schedules the next future run", async () => {
    const db = openLocalDatabase(":memory:");
    let now = new Date("2026-10-21T00:00:00.000Z");
    const bot = db.bots.create({ name: "Researcher" });
    const sent: string[] = [];
    const routines = new LocalRoutineRuntime({
      db,
      now: () => now,
      defaultTimezone: "UTC",
      runtime: {
        async sendMessage(botId, prompt) {
          sent.push(prompt);
          const runId = `run-${sent.length}`;
          db.runs.start({ id: runId, kind: "direct", botId, threadId: "thread-1" });
          return { runId };
        },
      },
    });
    const routine = routines.create(bot.id, {
      name: "Five-minute check",
      prompt: "Check the queue.",
      cron: "*/5 * * * *",
      timezone: "UTC",
    });

    now = new Date("2026-10-21T00:06:01.000Z");
    await routines.tick(now);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Automated routine");
    expect(routines.get(routine.id)).toMatchObject({
      enabled: true,
      lastRunAt: "2026-10-21T00:06:01.000Z",
      nextRunAt: "2026-10-21T00:10:00.000Z",
    });
    expect(routines.history(routine.id)[0]).toMatchObject({
      trigger: "missed",
      status: "completed",
      scheduledFor: "2026-10-21T00:05:00.000Z",
      runId: "run-1",
    });

    now = new Date("2026-10-21T00:07:00.000Z");
    const manual = await routines.runNow(routine.id);

    expect(manual).toMatchObject({ trigger: "manual", status: "completed" });
    expect(routines.get(routine.id)?.nextRunAt).toBe("2026-10-21T00:10:00.000Z");
    expect(sent).toHaveLength(2);
    db.close();
  });

  it("disables a one-time routine after it fires", async () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Writer" });
    const runAt = "2026-10-21T00:01:00.000Z";
    let now = new Date("2026-10-21T00:00:00.000Z");
    const routines = new LocalRoutineRuntime({
      db,
      now: () => now,
      defaultTimezone: "UTC",
      runtime: {
        async sendMessage() {
          db.runs.start({
            id: "one-shot-run",
            kind: "direct",
            botId: bot.id,
            threadId: "thread-1",
          });
          return { runId: "one-shot-run" };
        },
      },
    });
    const routine = routines.create(bot.id, {
      name: "Send once",
      prompt: "Send the final note.",
      cron: "@once",
      timezone: "UTC",
      runAt,
    });

    now = new Date("2026-10-21T00:02:00.000Z");
    await routines.tick(now);

    expect(routines.get(routine.id)).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastRunAt: "2026-10-21T00:02:00.000Z",
    });
    db.close();
  });
});
