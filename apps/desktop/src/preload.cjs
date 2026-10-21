const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  computer: {
    requestAccess: () => ipcRenderer.invoke("desktop.computer.requestAccess"),
    revokeAccess: () => ipcRenderer.invoke("desktop.computer.revokeAccess"),
    onConfigure: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("desktop.computer.configure", handler);
      return () => ipcRenderer.off("desktop.computer.configure", handler);
    },
  },
  localSettings: {
    request: (pathname, body) =>
      ipcRenderer.invoke("desktop.localSettings.request", pathname, body),
  },
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    state: () => ipcRenderer.invoke("desktop.window.state"),
  },
  update: {
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
  },
  local: {
    auth: {
      status: () => ipcRenderer.invoke("desktop.local.auth.status"),
      login: (email, password) =>
        ipcRenderer.invoke("desktop.local.auth.login", email, password),
      signUp: (name, email, password) =>
        ipcRenderer.invoke("desktop.local.auth.signUp", name, email, password),
      logout: () => ipcRenderer.invoke("desktop.local.auth.logout"),
    },
    bots: {
      list: () => ipcRenderer.invoke("desktop.local.bots.list"),
      archived: () => ipcRenderer.invoke("desktop.local.bots.archived"),
      restore: (botId) =>
        ipcRenderer.invoke("desktop.local.bots.restore", botId),
      deleteArchived: (botId) =>
        ipcRenderer.invoke("desktop.local.bots.deleteArchived", botId),
      create: (input) => ipcRenderer.invoke("desktop.local.bots.create", input),
      update: (botId, input) =>
        ipcRenderer.invoke("desktop.local.bots.update", botId, input),
    },
    messages: {
      list: (botId) => ipcRenderer.invoke("desktop.local.messages.list", botId),
      send: (botId, text, artifactIds) =>
        ipcRenderer.invoke(
          "desktop.local.messages.send",
          botId,
          text,
          artifactIds,
        ),
    },
    groups: {
      list: () => ipcRenderer.invoke("desktop.local.groups.list"),
      create: (input) =>
        ipcRenderer.invoke("desktop.local.groups.create", input),
      update: (groupId, input) =>
        ipcRenderer.invoke("desktop.local.groups.update", groupId, input),
      remove: (groupId) =>
        ipcRenderer.invoke("desktop.local.groups.remove", groupId),
      messages: {
        list: (groupId) =>
          ipcRenderer.invoke("desktop.local.groups.messages.list", groupId),
        send: (groupId, text, artifactIds) =>
          ipcRenderer.invoke(
            "desktop.local.groups.messages.send",
            groupId,
            text,
            artifactIds,
          ),
      },
      cancel: (groupId) =>
        ipcRenderer.invoke("desktop.local.groups.cancel", groupId),
    },
    runs: {
      cancel: (runId) => ipcRenderer.invoke("desktop.local.runs.cancel", runId),
      onStarted: (listener) => {
        const handler = (_event, run) => listener(run);
        ipcRenderer.on("desktop.local.run.started", handler);
        return () => ipcRenderer.off("desktop.local.run.started", handler);
      },
      onEvent: (listener) => {
        const handler = (_event, update) => listener(update);
        ipcRenderer.on("desktop.local.run.event", handler);
        return () => ipcRenderer.off("desktop.local.run.event", handler);
      },
    },
    settings: {
      get: () => ipcRenderer.invoke("desktop.local.settings.get"),
      update: (input) =>
        ipcRenderer.invoke("desktop.local.settings.update", input),
    },
    workspace: {
      open: () => ipcRenderer.invoke("desktop.local.workspace.open"),
    },
    browser: {
      status: () => ipcRenderer.invoke("desktop.local.browser.status"),
      startPairing: () =>
        ipcRenderer.invoke("desktop.local.browser.startPairing"),
      revoke: () => ipcRenderer.invoke("desktop.local.browser.revoke"),
    },
    diagnostics: {
      copy: () => ipcRenderer.invoke("desktop.local.diagnostics.copy"),
    },
    activity: {
      list: (limit) => ipcRenderer.invoke("desktop.local.activity.list", limit),
    },
    memory: {
      list: (input) => ipcRenderer.invoke("desktop.local.memory.list", input),
      update: (documentId, content, expectedRevision) =>
        ipcRenderer.invoke(
          "desktop.local.memory.update",
          documentId,
          content,
          expectedRevision,
        ),
      remove: (documentId) =>
        ipcRenderer.invoke("desktop.local.memory.remove", documentId),
    },
    routines: {
      list: (botId) => ipcRenderer.invoke("desktop.local.routines.list", botId),
      create: (botId, input) =>
        ipcRenderer.invoke("desktop.local.routines.create", botId, input),
      update: (routineId, input) =>
        ipcRenderer.invoke("desktop.local.routines.update", routineId, input),
      remove: (routineId) =>
        ipcRenderer.invoke("desktop.local.routines.remove", routineId),
      runNow: (routineId) =>
        ipcRenderer.invoke("desktop.local.routines.runNow", routineId),
      history: (routineId, limit) =>
        ipcRenderer.invoke("desktop.local.routines.history", routineId, limit),
    },
    artifacts: {
      create: (input) =>
        ipcRenderer.invoke("desktop.local.artifacts.create", input),
      list: (input) =>
        ipcRenderer.invoke("desktop.local.artifacts.list", input),
      read: (artifactId) =>
        ipcRenderer.invoke("desktop.local.artifacts.read", artifactId),
      remove: (artifactId) =>
        ipcRenderer.invoke("desktop.local.artifacts.remove", artifactId),
    },
    scratchpad: {
      list: (botId, includeDone) =>
        ipcRenderer.invoke("desktop.local.scratchpad.list", botId, includeDone),
      create: (botId, input) =>
        ipcRenderer.invoke("desktop.local.scratchpad.create", botId, input),
      update: (botId, itemId, input) =>
        ipcRenderer.invoke(
          "desktop.local.scratchpad.update",
          botId,
          itemId,
          input,
        ),
      remove: (botId, itemId) =>
        ipcRenderer.invoke("desktop.local.scratchpad.remove", botId, itemId),
    },
    tickets: {
      list: (input) => ipcRenderer.invoke("desktop.local.tickets.list", input),
      comments: (ticketId) =>
        ipcRenderer.invoke("desktop.local.tickets.comments", ticketId),
      create: (input) =>
        ipcRenderer.invoke("desktop.local.tickets.create", input),
      update: (ticketId, input) =>
        ipcRenderer.invoke("desktop.local.tickets.update", ticketId, input),
      comment: (ticketId, botId, body) =>
        ipcRenderer.invoke(
          "desktop.local.tickets.comment",
          ticketId,
          botId,
          body,
        ),
    },
    knowledge: {
      list: () => ipcRenderer.invoke("desktop.local.knowledge.list"),
      create: (input) =>
        ipcRenderer.invoke("desktop.local.knowledge.create", input),
      update: (documentId, input) =>
        ipcRenderer.invoke("desktop.local.knowledge.update", documentId, input),
      remove: (documentId) =>
        ipcRenderer.invoke("desktop.local.knowledge.remove", documentId),
    },
    skills: {
      list: () => ipcRenderer.invoke("desktop.local.skills.list"),
      create: (input) =>
        ipcRenderer.invoke("desktop.local.skills.create", input),
      update: (name, input) =>
        ipcRenderer.invoke("desktop.local.skills.update", name, input),
      remove: (name) => ipcRenderer.invoke("desktop.local.skills.remove", name),
    },
    secrets: {
      list: (botId) => ipcRenderer.invoke("desktop.local.secrets.list", botId),
      put: (botId, input) =>
        ipcRenderer.invoke("desktop.local.secrets.put", botId, input),
      remove: (botId, name) =>
        ipcRenderer.invoke("desktop.local.secrets.remove", botId, name),
      onRequest: (listener) => {
        const handler = (_event, request) => listener(request);
        ipcRenderer.on("desktop.local.secrets.request", handler);
        return () => ipcRenderer.off("desktop.local.secrets.request", handler);
      },
      respond: (requestId, response) =>
        ipcRenderer.invoke(
          "desktop.local.secrets.respond",
          requestId,
          response,
        ),
    },
    prompts: {
      onChoiceRequest: (listener) => {
        const handler = (_event, request) => listener(request);
        ipcRenderer.on("desktop.local.choice.request", handler);
        return () => ipcRenderer.off("desktop.local.choice.request", handler);
      },
      respondChoice: (requestId, answer) =>
        ipcRenderer.invoke("desktop.local.choice.respond", requestId, answer),
    },
    manifest: {
      state: () => ipcRenderer.invoke("desktop.local.manifest.state"),
      onUpdated: (listener) => {
        const handler = (_event, state) => listener(state);
        ipcRenderer.on("desktop.local.manifest.updated", handler);
        return () => ipcRenderer.off("desktop.local.manifest.updated", handler);
      },
    },
  },
  oauth: {
    open: (url) => ipcRenderer.invoke("desktop.oauth.open", url),
    cancel: (url) => ipcRenderer.invoke("desktop.oauth.cancel", url),
    onCallback: (listener) => {
      // The IpcRendererEvent stays in the preload: the renderer only sees the code.
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.oauth.callback", handler);
      return () => ipcRenderer.off("desktop.oauth.callback", handler);
    },
  },
});
