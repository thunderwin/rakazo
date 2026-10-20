(() => {
  const api = window.rakazoDesktop?.local;
  const botsElement = document.getElementById("bots");
  const messagesElement = document.getElementById("messages");
  const titleElement = document.getElementById("bot-title");
  const detailElement = document.getElementById("bot-detail");
  const statusElement = document.getElementById("status");
  const inputElement = document.getElementById("new-bot-name");
  const createButton = document.getElementById("create-bot");
  const composer = document.getElementById("composer");
  const messageText = document.getElementById("message-text");
  const sendButton = document.getElementById("send");
  const stopButton = document.getElementById("stop");
  const loginElement = document.getElementById("login");
  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginSubmit = document.getElementById("login-submit");
  const loginToggle = document.getElementById("login-toggle");
  const loginTitle = document.getElementById("login-title");
  const loginNameField = document.getElementById("login-name-field");
  const loginName = document.getElementById("login-name");
  const loginError = document.getElementById("login-error");
  const loginServer = document.getElementById("login-server");
  const logoutButton = document.getElementById("logout");
  const settingsOpen = document.getElementById("settings-open");
  const settingsView = document.getElementById("settings-view");
  const settingsForm = document.getElementById("settings-form");
  const settingsDefaultModel = document.getElementById("settings-default-model");
  const settingsTheme = document.getElementById("settings-theme");
  const settingsEnter = document.getElementById("settings-enter");
  const settingsError = document.getElementById("settings-error");
  const settingsCancel = document.getElementById("settings-cancel");
  const botSettingsName = document.getElementById("bot-settings-name");
  const botSettingsDescription = document.getElementById("bot-settings-description");
  const botSettingsModel = document.getElementById("bot-settings-model");
  const botSettingsThinking = document.getElementById("bot-settings-thinking");
  const botSettingsInstructions = document.getElementById("bot-settings-instructions");
  const browserStatus = document.getElementById("browser-status");
  const browserHelp = document.getElementById("browser-help");
  const browserConnect = document.getElementById("browser-connect");
  const browserDisconnect = document.getElementById("browser-disconnect");
  const browserPairing = document.getElementById("browser-pairing");
  const diagnosticsCopy = document.getElementById("diagnostics-copy");
  const diagnosticsStatus = document.getElementById("diagnostics-status");

  let bots = [];
  let activeBotId = null;
  let botSelectionGeneration = 0;
  let activeRunId = null;
  let busy = false;
  let stopRequested = false;
  let liveText = "";
  let liveStatus = "";
  let hasServerUrl = false;
  let signUpMode = false;
  let userSettings = {
    theme: "system",
    sendWithEnter: true,
    defaultModelId: null,
  };
  let browserPollTimer = null;

  function setStatus(message, isError = false) {
    statusElement.textContent = message ?? "";
    statusElement.classList.toggle("error", isError);
  }

  function errorMessage(error, fallback) {
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message
    ) {
      return error.message;
    }
    return fallback;
  }

  function applyTheme() {
    const prefersLight =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
        : false;
    const theme =
      userSettings.theme === "system" ? (prefersLight ? "light" : "dark") : userSettings.theme;
    document.documentElement.dataset.theme = theme;
  }

  async function loadSettings() {
    if (!api.settings) return;
    userSettings = await api.settings.get();
    applyTheme();
  }

  function openBotSettings() {
    const bot = bots.find((item) => item.id === activeBotId);
    settingsDefaultModel.value = userSettings.defaultModelId ?? "";
    settingsTheme.value = userSettings.theme;
    settingsEnter.checked = userSettings.sendWithEnter;
    settingsError.textContent = "";
    botSettingsName.value = bot?.name ?? "";
    botSettingsDescription.value = bot?.description ?? "";
    botSettingsModel.value = bot?.modelId ?? "";
    botSettingsThinking.value = bot?.thinkingLevel ?? "";
    botSettingsInstructions.value = bot?.instructions ?? "";
    settingsView.hidden = false;
    startBrowserStatusPolling();
    void refreshBrowserStatus();
    settingsDefaultModel.focus();
  }

  async function refreshBrowserStatus() {
    if (!api.browser) {
      browserStatus.textContent = "Browser bridge is unavailable in this build.";
      browserConnect.disabled = true;
      return;
    }
    try {
      const status = await api.browser.status();
      browserStatus.textContent = status.connected
        ? `Chrome connected${status.clientVersion ? ` · ${status.clientVersion}` : ""}`
        : status.available
          ? `Chrome not connected · local port ${status.port}`
          : status.error || "Browser bridge is unavailable.";
      browserConnect.textContent = status.connected ? "Pair another Chrome" : "Connect Chrome";
      browserConnect.disabled = !status.available;
      browserDisconnect.disabled = !status.connected;
      browserHelp.hidden = status.connected;
    } catch (error) {
      browserStatus.textContent = errorMessage(error, "Could not read browser status");
      browserConnect.disabled = true;
      browserDisconnect.disabled = true;
    }
  }

  function startBrowserStatusPolling() {
    stopBrowserStatusPolling();
    browserPollTimer = window.setInterval(() => {
      if (!settingsView.hidden) void refreshBrowserStatus();
    }, 1_000);
  }

  function stopBrowserStatusPolling() {
    if (browserPollTimer !== null) window.clearInterval(browserPollTimer);
    browserPollTimer = null;
  }

  function closeSettings() {
    settingsView.hidden = true;
    stopBrowserStatusPolling();
  }

  async function startBrowserPairing() {
    if (!api.browser) return;
    browserConnect.disabled = true;
    browserPairing.hidden = true;
    try {
      const offer = await api.browser.startPairing();
      browserPairing.textContent = `In the ericBot Browser Bridge extension, enter port ${offer.port} and code ${offer.code}.`;
      browserPairing.hidden = false;
    } catch (error) {
      browserStatus.textContent = errorMessage(error, "Could not start browser pairing");
    } finally {
      browserConnect.disabled = false;
    }
  }

  async function disconnectBrowser() {
    if (!api.browser) return;
    browserDisconnect.disabled = true;
    browserPairing.hidden = true;
    try {
      await api.browser.revoke();
      await refreshBrowserStatus();
    } catch (error) {
      browserStatus.textContent = errorMessage(error, "Could not disconnect Chrome");
    }
  }

  async function copyDiagnostics() {
    if (!api.diagnostics) {
      diagnosticsStatus.textContent = "Diagnostics are unavailable in this build.";
      return;
    }
    diagnosticsCopy.disabled = true;
    diagnosticsStatus.textContent = "";
    try {
      await api.diagnostics.copy();
      diagnosticsStatus.textContent = "Diagnostics copied. They contain no messages or tokens.";
    } catch (error) {
      diagnosticsStatus.textContent = errorMessage(error, "Could not copy diagnostics");
    } finally {
      diagnosticsCopy.disabled = false;
    }
  }

  async function saveSettings() {
    settingsError.textContent = "";
    try {
      userSettings = await api.settings.update({
        theme: settingsTheme.value,
        sendWithEnter: settingsEnter.checked,
        defaultModelId: settingsDefaultModel.value.trim() || null,
      });
      applyTheme();
      if (activeBotId) {
        await api.bots.update(activeBotId, {
          name: botSettingsName.value,
          description: botSettingsDescription.value,
          instructions: botSettingsInstructions.value,
          modelId: botSettingsModel.value.trim() || null,
          thinkingLevel: botSettingsThinking.value || null,
        });
        await refreshBots();
      }
      settingsView.hidden = true;
      stopBrowserStatusPolling();
    } catch (error) {
      settingsError.textContent =
        error instanceof Error ? error.message : "Could not save settings";
    }
  }

  function textOfMessage(message) {
    return (message.blocks ?? [])
      .map((block) => {
        if (!block || typeof block !== "object" || Array.isArray(block)) return "";
        if (block.kind === "text" && typeof block.text === "string") return block.text;
        if (block.kind === "error" && typeof block.message === "string") {
          return block.message === "Run stopped." ? block.message : `Run failed: ${block.message}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function renderBots() {
    botsElement.replaceChildren();
    for (const bot of bots) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `bot${bot.id === activeBotId ? " active" : ""}`;
      button.textContent = bot.name;
      button.addEventListener("click", () => {
        void selectBot(bot.id);
      });
      botsElement.append(button);
    }
  }

  function renderMessages(messages) {
    messagesElement.replaceChildren();
    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No messages yet. Say hello.";
      messagesElement.append(empty);
      return;
    }
    for (const message of messages) {
      const article = document.createElement("article");
      article.className = `message ${message.role === "user" ? "user" : "bot"}`;
      const role = document.createElement("span");
      role.className = "role";
      role.textContent = message.role === "user" ? "You" : "Bot";
      const text = document.createElement("span");
      text.textContent = textOfMessage(message);
      article.append(role, text);
      messagesElement.append(article);
    }
    messagesElement.scrollTop = messagesElement.scrollHeight;
    renderLive();
  }

  function renderLive() {
    messagesElement.querySelector(".message.live")?.remove();
    if (!liveText && !liveStatus) return;
    const article = document.createElement("article");
    article.className = "message bot live";
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = "Bot";
    const text = document.createElement("span");
    text.textContent = [liveStatus, liveText].filter(Boolean).join("\n\n");
    article.append(role, text);
    messagesElement.append(article);
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function setBusy(next) {
    busy = next;
    sendButton.disabled = next;
    messageText.disabled = next;
    stopButton.hidden = !next;
    stopButton.disabled = false;
  }

  function toolLabel(event) {
    if (event.name === "shell") return "Running a local command…";
    if (event.name === "list_files") return "Listing local files…";
    if (event.name === "read_file") return "Reading a local file…";
    if (event.name === "write_file") return "Writing a local file…";
    if (event.name === "browser_open" || event.name === "browser_navigate") {
      return "Opening a browser page…";
    }
    if (event.name === "browser_observe") return "Reading the browser page…";
    if (event.name === "browser_click") return "Clicking in the browser…";
    if (event.name === "browser_type") return "Typing in the browser…";
    if (event.name === "browser_scroll") return "Scrolling the browser page…";
    if (event.name === "browser_borrow_tab") return "Taking over an existing tab…";
    return `Using ${event.name}…`;
  }

  async function selectBot(botId) {
    if (busy && botId !== activeBotId) return;
    const generation = ++botSelectionGeneration;
    activeBotId = botId;
    const bot = bots.find((item) => item.id === botId);
    titleElement.textContent = bot?.name ?? "Local chat";
    detailElement.textContent = bot?.description || "Local bot";
    renderBots();
    setStatus("Loading…");
    try {
      const messages = await api.messages.list(botId);
      if (generation !== botSelectionGeneration) return;
      renderMessages(messages);
      setStatus("");
    } catch (error) {
      if (generation !== botSelectionGeneration) return;
      setStatus(error instanceof Error ? error.message : "Could not load messages", true);
    }
  }

  async function refreshBots() {
    bots = await api.bots.list();
    if (bots.length === 0) {
      const bot = await api.bots.create({ name: "Assistant" });
      bots = [bot];
    }
    if (!activeBotId || !bots.some((bot) => bot.id === activeBotId)) {
      activeBotId = bots[0].id;
    }
    renderBots();
    await selectBot(activeBotId);
  }

  async function createBot() {
    const name = inputElement.value.trim();
    if (!name) return;
    createButton.disabled = true;
    try {
      const bot = await api.bots.create({ name });
      inputElement.value = "";
      bots.push(bot);
      await selectBot(bot.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create bot", true);
    } finally {
      createButton.disabled = false;
    }
  }

  function showLogin(serverUrl) {
    hasServerUrl = true;
    loginServer.textContent = serverUrl;
    loginElement.hidden = false;
    logoutButton.hidden = true;
    settingsOpen.hidden = true;
    settingsView.hidden = true;
    stopBrowserStatusPolling();
    loginError.textContent = "";
    loginEmail.focus();
  }

  function hideLogin() {
    loginElement.hidden = true;
    logoutButton.hidden = !hasServerUrl;
  }

  async function login() {
    loginSubmit.disabled = true;
    loginError.textContent = "";
    try {
      if (signUpMode) {
        await api.auth.signUp(loginName.value, loginEmail.value, loginPassword.value);
      } else {
        await api.auth.login(loginEmail.value, loginPassword.value);
      }
      loginPassword.value = "";
      hideLogin();
      await refreshBots();
      await loadSettings();
      settingsOpen.hidden = !api.settings;
      setStatus("");
    } catch (error) {
      loginError.textContent = error instanceof Error ? error.message : "Could not sign in";
    } finally {
      loginSubmit.disabled = false;
    }
  }

  function setSignUpMode(next) {
    signUpMode = next;
    loginTitle.textContent = next ? "Create account" : "Sign in";
    loginNameField.hidden = !next;
    loginSubmit.textContent = next ? "Create account" : "Sign in";
    loginToggle.textContent = next ? "Back to sign in" : "Create account";
    loginError.textContent = "";
    (next ? loginName : loginEmail).focus();
  }

  async function logout() {
    await api.auth.logout().catch(() => undefined);
    settingsOpen.hidden = true;
    settingsView.hidden = true;
    bots = [];
    activeBotId = null;
    botSelectionGeneration += 1;
    botsElement.replaceChildren();
    messagesElement.replaceChildren();
    titleElement.textContent = "Local chat";
    detailElement.textContent = "Sign in to continue.";
    setStatus("");
    if (hasServerUrl) showLogin(loginServer.textContent ?? "");
  }

  async function initialize() {
    const status = await api.auth.status();
    if (status.serverUrl) {
      if (!status.signedIn) {
        showLogin(status.serverUrl);
        return;
      }
      hasServerUrl = true;
      hideLogin();
    } else {
      loginElement.hidden = true;
      logoutButton.hidden = true;
      settingsOpen.hidden = true;
      settingsView.hidden = true;
    }
    await refreshBots();
    await loadSettings();
    settingsOpen.hidden = !api.settings;
  }

  async function sendMessage() {
    const text = messageText.value.trim();
    if (!text || !activeBotId || busy) return;
    activeRunId = null;
    stopRequested = false;
    liveText = "";
    liveStatus = "Thinking…";
    setBusy(true);
    setStatus("");
    const optimistic = document.createElement("article");
    optimistic.className = "message user optimistic";
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = "You";
    const body = document.createElement("span");
    body.textContent = text;
    optimistic.append(role, body);
    messagesElement.append(optimistic);
    renderLive();
    let terminalError = null;
    try {
      await api.messages.send(activeBotId, text);
      messageText.value = "";
    } catch (error) {
      terminalError = stopRequested ? "Stopped" : errorMessage(error, "Could not send message");
    } finally {
      activeRunId = null;
      liveText = "";
      liveStatus = "";
      setBusy(false);
      await selectBot(activeBotId);
      if (terminalError) setStatus(terminalError, !stopRequested);
      messageText.focus();
    }
  }

  async function stopRun() {
    if (!activeRunId || !api.runs) return;
    stopRequested = true;
    stopButton.disabled = true;
    liveStatus = "Stopping…";
    renderLive();
    try {
      await api.runs.cancel(activeRunId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not stop the run", true);
      stopButton.disabled = false;
    }
  }

  createButton.addEventListener("click", () => void createBot());
  inputElement.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void createBot();
    }
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage();
  });
  messageText.addEventListener("keydown", (event) => {
    if (userSettings.sendWithEnter && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void login();
  });
  settingsOpen.addEventListener("click", openBotSettings);
  settingsCancel.addEventListener("click", () => {
    closeSettings();
  });
  browserConnect.addEventListener("click", () => void startBrowserPairing());
  browserDisconnect.addEventListener("click", () => void disconnectBrowser());
  diagnosticsCopy.addEventListener("click", () => void copyDiagnostics());
  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings();
  });
  loginToggle.addEventListener("click", () => setSignUpMode(!signUpMode));
  logoutButton.addEventListener("click", () => void logout());
  stopButton.addEventListener("click", () => void stopRun());

  api?.runs?.onStarted((run) => {
    activeRunId = run.runId;
  });
  api?.runs?.onEvent(({ runId, event }) => {
    if (runId !== activeRunId || !event || typeof event !== "object") return;
    if (event.type === "text" && typeof event.text === "string") {
      liveText += event.text;
      liveStatus = "";
    } else if (event.type === "progress" && typeof event.text === "string") {
      liveStatus = event.text;
    } else if (event.type === "tool") {
      liveStatus = toolLabel(event);
    } else if (event.type === "ask" && typeof event.text === "string") {
      liveStatus = event.text;
    }
    renderLive();
  });

  if (!api) {
    setStatus("Local bridge is unavailable.", true);
    return;
  }
  void initialize().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Could not open local database", true);
  });
})();
