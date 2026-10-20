interface StatusResult {
  connected: boolean;
  port: number | null;
  clientVersion: string | null;
  error?: string;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Popup markup is missing ${selector}`);
  return element;
}

const status = required<HTMLParagraphElement>("#status");
const pairing = required<HTMLElement>("#pairing");
const port = required<HTMLInputElement>("#port");
const code = required<HTMLInputElement>("#code");
const pair = required<HTMLButtonElement>("#pair");
const disconnect = required<HTMLButtonElement>("#disconnect");
const message = required<HTMLParagraphElement>("#message");

function showError(error: unknown) {
  message.textContent = error instanceof Error ? error.message : String(error);
}

async function send<T>(payload: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(payload)) as {
    ok?: boolean;
    result?: T;
    error?: string;
  };
  if (!response?.ok) throw new Error(response?.error ?? "Background request failed");
  return response.result as T;
}

async function refresh() {
  try {
    const result = await send<StatusResult>({ type: "status" });
    status.textContent = result.connected
      ? `Connected${result.clientVersion ? ` · ${result.clientVersion}` : ""}`
      : result.error || "Not connected";
    pairing.hidden = result.connected;
    disconnect.disabled = !result.connected;
    if (result.port !== null) port.value = String(result.port);
    if (result.connected) message.textContent = "";
  } catch (error) {
    status.textContent = "Not connected";
    showError(error);
  }
}

pair.addEventListener("click", async () => {
  pair.disabled = true;
  message.textContent = "";
  try {
    const portNumber = Number(port.value);
    if (!Number.isInteger(portNumber) || portNumber < 1024 || portNumber > 65535) {
      throw new Error("Enter the port shown in ericBot Settings.");
    }
    if (!/^\d{6}$/.test(code.value.trim())) {
      throw new Error("Enter the six-digit pairing code.");
    }
    await send({ type: "pair", port: portNumber, code: code.value.trim() });
    code.value = "";
    await refresh();
  } catch (error) {
    showError(error);
  } finally {
    pair.disabled = false;
  }
});
for (const input of [port, code]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      pair.click();
    }
  });
}

disconnect.addEventListener("click", async () => {
  message.textContent = "";
  try {
    await send({ type: "disconnect" });
    await refresh();
  } catch (error) {
    showError(error);
  }
});

void refresh();
