import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { DesktopBrowserBridge } from "../../desktop/src/browser-bridge.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dist");

function writePage(request: IncomingMessage, response: ServerResponse) {
  const signedIn = request.headers.cookie?.split(/;\s*/).includes("erb_session=ok");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html>
      <head><title>ericBot browser test</title></head>
      <body>
        <h1 id="account">${signedIn ? "Signed in as Browser User" : "Signed out"}</h1>
        <label for="note">Note</label>
        <input id="note" />
        <button id="save" type="button">Save</button>
        <p id="result"></p>
        <script>
          document.querySelector("#save").addEventListener("click", () => {
            document.querySelector("#result").textContent =
              "Saved: " + document.querySelector("#note").value;
          });
        </script>
      </body>
    </html>`);
}

async function waitFor<T>(read: () => T | Promise<T>, predicate: (value: T) => boolean) {
  const deadline = Date.now() + 10_000;
  let value: T;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for browser state: ${JSON.stringify(value)}`);
}

async function pageForUrl(context: BrowserContext, url: string): Promise<Page> {
  return waitFor(
    () => context.pages().find((page) => page.url() === url),
    (page): page is Page => page !== undefined,
  );
}

const server = createServer(writePage);
const temporary = await mkdtemp(path.join(tmpdir(), "ericbot-browser-e2e-"));
let context: BrowserContext | undefined;
let bridge: DesktopBrowserBridge | undefined;

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server failed");
  const url = `http://127.0.0.1:${address.port}/app`;

  bridge = new DesktopBrowserBridge({
    userDataDir: temporary,
    port: 0,
    requestTimeoutMs: 10_000,
  });
  const bridgeStatus = await bridge.start();
  if (!bridgeStatus.available) throw new Error(bridgeStatus.error ?? "Bridge did not start");

  context = await chromium.launchPersistentContext(path.join(temporary, "chrome"), {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--no-first-run",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  await context.addCookies([
    {
      name: "erb_session",
      value: "ok",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const worker = await waitFor(
    () => context?.serviceWorkers().find((candidate) => candidate.url().includes("/background.js")),
    (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
  );
  const extensionId = new URL(worker.url()).hostname;
  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${extensionId}/popup.html`);
  const offer = bridge.startPairing();
  const paired = await controlPage.evaluate(async (input) => chrome.runtime.sendMessage(input), {
    type: "pair",
    port: offer.port,
    code: offer.code,
  });
  if (!(paired as { ok?: boolean } | undefined)?.ok) {
    throw new Error(`Extension pairing failed: ${JSON.stringify(paired)}`);
  }
  await waitFor(
    () => bridge?.status(),
    (status) => status?.connected === true,
  );
  await controlPage.close();

  const runId = "browser-e2e-run";
  await bridge.open(runId, url);
  const agentPage = await pageForUrl(context, url);
  await agentPage.waitForLoadState("domcontentloaded");

  let observation = await bridge.observe(runId);
  if (!observation.text.includes("Signed in as Browser User")) {
    throw new Error(`Existing Chrome login state was not reused: ${observation.text}`);
  }
  const note = observation.elements.find((element) => element.name === "Note");
  if (!note) throw new Error("Observed page did not expose the Note input");
  await bridge.type(runId, { ref: note.ref, text: "hello from ericBot", clear: true });

  observation = await bridge.observe(runId);
  const save = observation.elements.find((element) => element.name === "Save");
  if (!save) throw new Error("Observed page did not expose the Save button");
  await bridge.click(runId, save.ref);
  await agentPage.waitForFunction(
    () => document.querySelector("#result")?.textContent === "Saved: hello from ericBot",
  );

  const userPage = await context.newPage();
  await userPage.goto(url);
  await userPage.waitForLoadState("domcontentloaded");
  const tabs = await bridge.listTabs(runId);
  const userTab = tabs.find((tab) => tab.url === url && tab.tab_id !== observation.tab_id);
  if (!userTab) throw new Error("browser_list_tabs did not include the existing user tab");

  const borrowRun = "browser-e2e-borrow";
  await bridge.borrowTab(borrowRun, userTab.tab_id);
  const borrowed = await bridge.observe(borrowRun);
  if (!borrowed.text.includes("Signed in as Browser User")) {
    throw new Error("Borrowed tab did not retain the Chrome login state");
  }
  await bridge.returnTab(borrowRun, userTab.tab_id);
  await bridge.closeSession(borrowRun);

  await bridge.closeSession(runId);
  await waitFor(
    () => context?.pages().includes(agentPage) ?? false,
    (present) => present === false,
  );
  await bridge.revoke();
  await waitFor(
    () => bridge?.status(),
    (status) => status?.connected === false,
  );
  const revokedPage = await context.newPage();
  await revokedPage.goto(`chrome-extension://${extensionId}/popup.html`);
  const revokedSettings = await revokedPage.evaluate(async () => {
    const stored = await chrome.storage.local.get("ericbot.bridge-settings");
    return stored["ericbot.bridge-settings"] as { token?: string | null } | undefined;
  });
  if (revokedSettings?.token) throw new Error("Browser bridge token survived revocation");
  console.log("Browser extension end-to-end test passed.");
} finally {
  await bridge?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(temporary, { recursive: true, force: true });
}
