export function adminControlPlanePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ericBot Control</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 64px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
    h1 { margin: 0; font-size: 24px; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    p { color: GrayText; line-height: 1.5; }
    .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; }
    .panel { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 14px; padding: 16px; }
    .stack { display: grid; gap: 12px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, input, select, textarea { font: inherit; }
    button { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; background: ButtonFace; color: ButtonText; padding: 7px 10px; cursor: pointer; }
    button:hover { background: color-mix(in srgb, CanvasText 8%, ButtonFace); }
    button[aria-pressed="true"] { background: CanvasText; color: Canvas; }
    button.danger { color: #c33; }
    input, select, textarea { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; background: Field; color: FieldText; padding: 7px 9px; }
    textarea { width: 100%; min-height: 430px; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
    #orgs { display: grid; gap: 6px; }
    #orgs button { text-align: left; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 4px; border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
    #status { min-height: 20px; font-size: 13px; }
    #editor { display: grid; gap: 12px; }
    #members { display: grid; gap: 12px; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>ericBot Control</h1>
        <p>Internal organization and client preset management.</p>
      </div>
      <span id="identity">Checking session…</span>
    </header>
    <div id="status" role="status"></div>
    <div class="layout">
      <aside class="panel stack">
        <div>
          <h2>Organizations</h2>
          <div id="orgs"></div>
        </div>
        <form id="create-org" class="stack" hidden>
          <h2>New organization</h2>
          <input name="name" placeholder="Example Company" maxlength="120" required />
          <input name="slug" placeholder="example-company" maxlength="100" required />
          <input name="ownerEmail" type="email" placeholder="Owner email (optional)" />
          <button type="submit">Create</button>
        </form>
      </aside>
      <section id="detail" class="panel stack" hidden>
        <div class="row" style="justify-content: space-between">
          <h2 id="org-name"></h2>
          <span id="manifest-version"></span>
        </div>
        <div id="members">
          <h2>Members</h2>
          <form id="add-member" class="row">
            <input name="email" type="email" placeholder="user@example.com" required />
            <select name="role"><option value="member">Member</option><option value="admin">Admin</option></select>
            <button type="submit">Add member</button>
          </form>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody id="member-rows"></tbody>
          </table>
        </div>
        <div id="editor">
          <div class="row" style="justify-content: space-between">
            <h2>Client manifest</h2>
            <div class="row">
              <button type="button" id="sample">Load sample</button>
              <button type="button" id="publish">Publish version</button>
            </div>
          </div>
          <p>Unsigned JSON distribution. Signature verification remains required before the desktop client applies a manifest.</p>
          <textarea id="manifest" spellcheck="false"></textarea>
        </div>
      </section>
    </div>
  </main>
  <script>
    const sample = {
      name: "Example Company",
      minimumClientVersion: "0.3.0",
      botTemplates: [],
      groupPresets: [],
      knowledge: [],
      skills: [],
      routines: [],
      featurePolicy: { disabledTools: [], allowComputerUse: false }
    };
    const state = { me: null, organization: null };
    const $ = (selector) => document.querySelector(selector);
    const status = (text) => { $("#status").textContent = text; };
    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    }
    function row(...children) {
      const tr = document.createElement("tr");
      for (const child of children) {
        const td = document.createElement("td");
        if (child instanceof Node) td.append(child); else td.textContent = child;
        tr.append(td);
      }
      return tr;
    }
    async function load() {
      try {
        state.me = await api("/v1/admin/control/me");
        $("#identity").textContent = state.me.platformAdmin ? "Platform administrator" : "Organization administrator";
        $("#create-org").hidden = !state.me.platformAdmin;
        renderOrganizations();
        status("");
      } catch (error) {
        $("#identity").textContent = "Not authorized";
        status(error.message);
      }
    }
    function renderOrganizations() {
      const root = $("#orgs");
      root.replaceChildren();
      for (const organization of state.me.organizations) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = organization.name + " · " + organization.memberCount + " members";
        button.setAttribute("aria-pressed", String(state.organization?.id === organization.id));
        button.addEventListener("click", () => selectOrganization(organization));
        root.append(button);
      }
      if (!state.me.organizations.length) {
        const p = document.createElement("p");
        p.textContent = "No organizations available.";
        root.append(p);
      }
    }
    async function selectOrganization(organization) {
      state.organization = organization;
      renderOrganizations();
      $("#detail").hidden = false;
      $("#org-name").textContent = organization.name;
      status("Loading…");
      try {
        const [members, manifest] = await Promise.all([
          api("/v1/admin/control/organizations/" + encodeURIComponent(organization.id) + "/members"),
          api("/v1/admin/control/organizations/" + encodeURIComponent(organization.id) + "/manifest")
        ]);
        renderMembers(members.members);
        $("#manifest").value = JSON.stringify(manifest.manifest?.content ?? sample, null, 2);
        $("#manifest-version").textContent = manifest.manifest ? "Version " + manifest.manifest.version : "No published manifest";
        status("");
      } catch (error) {
        status(error.message);
      }
    }
    function renderMembers(members) {
      const rows = $("#member-rows");
      rows.replaceChildren();
      for (const member of members) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          try {
            await api("/v1/admin/control/organizations/" + encodeURIComponent(state.organization.id) + "/members/" + encodeURIComponent(member.userId), { method: "DELETE" });
            await selectOrganization(state.organization);
          } catch (error) { status(error.message); }
        });
        rows.append(row(member.name, member.email, member.role, remove));
      }
    }
    $("#create-org").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        const ownerEmail = String(form.get("ownerEmail") || "").trim();
        await api("/v1/admin/control/organizations", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            slug: form.get("slug"),
            ...(ownerEmail ? { ownerEmail } : {})
          })
        });
        event.currentTarget.reset();
        await load();
      } catch (error) { status(error.message); }
    });
    $("#add-member").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api("/v1/admin/control/organizations/" + encodeURIComponent(state.organization.id) + "/members", {
          method: "POST",
          body: JSON.stringify({ email: form.get("email"), role: form.get("role") })
        });
        event.currentTarget.reset();
        await selectOrganization(state.organization);
      } catch (error) { status(error.message); }
    });
    $("#sample").addEventListener("click", () => {
      $("#manifest").value = JSON.stringify(sample, null, 2);
    });
    $("#publish").addEventListener("click", async () => {
      try {
        const content = JSON.parse($("#manifest").value);
        const result = await api("/v1/admin/control/organizations/" + encodeURIComponent(state.organization.id) + "/manifest", {
          method: "PUT",
          body: JSON.stringify(content)
        });
        $("#manifest-version").textContent = "Version " + result.version;
        status("Published version " + result.version);
        await load();
      } catch (error) { status(error.message); }
    });
    void load();
  </script>
</body>
</html>`;
}
