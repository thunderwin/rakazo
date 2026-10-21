import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalDesktopTools } from "./desktop-tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("local desktop tools", () => {
  it("opens workspace files and public URLs through injected desktop actions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rakazo-desktop-tools-"));
    directories.push(directory);
    await writeFile(path.join(directory, "report.pdf"), "test");
    const openFile = vi.fn(async () => "");
    const openUrl = vi.fn(async () => undefined);
    const tools = createLocalDesktopTools({
      workspaceDir: directory,
      openFile,
      openUrl,
      launchApp: vi.fn(async () => undefined),
    });

    await tools[0]!.execute({
      name: "open_path",
      args: { path: "report.pdf" },
      executionId: "open-1",
    });
    await tools[0]!.execute({
      name: "open_path",
      args: { path: "https://example.com" },
      executionId: "open-2",
    });
    expect(openFile).toHaveBeenCalledWith(expect.stringMatching(/report\.pdf$/));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/");
  });

  it("rejects non-HTTP application URIs", async () => {
    const launchApp = vi.fn(async () => undefined);
    const tools = createLocalDesktopTools({
      workspaceDir: tmpdir(),
      openFile: vi.fn(async () => ""),
      openUrl: vi.fn(async () => undefined),
      launchApp,
    });
    await expect(
      tools[1]!.execute({
        name: "launch_app",
        args: { application: "Safari", uri: "file:///etc/passwd" },
        executionId: "launch-1",
      }),
    ).rejects.toThrow("Only HTTP and HTTPS URLs");
    expect(launchApp).not.toHaveBeenCalled();
  });
});
