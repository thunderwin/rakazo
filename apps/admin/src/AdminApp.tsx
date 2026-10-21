import type {
  ClientManifestContent,
  ControlPlaneMember,
  ControlPlaneOrganization,
} from "@rakazo/contracts";
import { useEffect, useState } from "react";
import {
  type AdminSession,
  ApiError,
  addOrganizationMember,
  adminSession,
  createOrganization,
  organizationManifest,
  organizationMembers,
  publishOrganizationManifest,
  removeOrganizationMember,
  signIn,
} from "./api";

const EMPTY_MANIFEST: ClientManifestContent = {
  name: "示例企业",
  minimumClientVersion: "0.3.0",
  botTemplates: [],
  groupPresets: [],
  knowledge: [],
  skills: [],
  routines: [],
  featurePolicy: { disabledTools: [], allowComputerUse: false },
};

function roleLabel(role: string): string {
  if (role === "platform_admin") return "平台管理员";
  if (role === "owner") return "企业所有者";
  if (role === "admin") return "企业管理员";
  return "成员";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function newKey(kind: string): string {
  return `${kind}-${crypto.randomUUID()}`;
}

function isPersonalOrganization(organization: ControlPlaneOrganization): boolean {
  return organization.name === "Personal" || organization.slug.startsWith("user-");
}

export function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<ControlPlaneMember[]>([]);
  const [manifest, setManifest] = useState<ClientManifestContent>(EMPTY_MANIFEST);
  const [manifestVersion, setManifestVersion] = useState<number | null>(null);
  const [advancedText, setAdvancedText] = useState(JSON.stringify(EMPTY_MANIFEST, null, 2));
  const [advancedError, setAdvancedError] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "admin">("member");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgOwner, setOrgOwner] = useState("");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const selected =
    session?.organizations.find((organization) => organization.id === selectedId) ?? null;
  const enterpriseOrganizations =
    session?.organizations.filter((organization) => !isPersonalOrganization(organization)) ?? [];
  const personalOrganizations = session?.organizations.filter(isPersonalOrganization) ?? [];

  async function loadSession(selectFirst = true) {
    setLoading(true);
    setError("");
    try {
      const next = await adminSession();
      setSession(next);
      if (selectFirst && !selectedId && next.organizations[0]) {
        const preferred =
          next.organizations.find((organization) => !isPersonalOrganization(organization)) ??
          next.organizations[0];
        setSelectedId(preferred.id);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setSession(null);
      } else {
        setError(messageOf(cause));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadOrganization(organization: ControlPlaneOrganization) {
    setSelectedId(organization.id);
    setRemovingMemberId(null);
    setError("");
    setNotice("");
    try {
      const [nextMembers, nextManifest] = await Promise.all([
        organizationMembers(organization.id),
        organizationManifest(organization.id),
      ]);
      setMembers(nextMembers.members);
      const content = nextManifest.manifest?.content ?? {
        ...EMPTY_MANIFEST,
        name: organization.name,
      };
      setManifest(content);
      setAdvancedText(JSON.stringify(content, null, 2));
      setAdvancedError("");
      setManifestVersion(nextManifest.manifest?.version ?? null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (!selected) return;
    void loadOrganization(selected);
  }, [selected?.id]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await signIn(email, password);
      setPassword("");
      await loadSession();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function createOrg(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const organization = await createOrganization({
        name: orgName,
        slug: orgSlug,
        ...(orgOwner.trim() ? { ownerEmail: orgOwner.trim() } : {}),
      });
      setOrgName("");
      setOrgSlug("");
      setOrgOwner("");
      await loadSession(false);
      setSelectedId(organization.id);
      setNotice("企业已创建。");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError("");
    try {
      await addOrganizationMember(selected.id, {
        email: memberEmail,
        role: memberRole,
      });
      setMemberEmail("");
      const next = await organizationMembers(selected.id);
      setMembers(next.members);
      setNotice("成员已添加。");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function removeMember(member: ControlPlaneMember) {
    if (!selected) return;
    if (removingMemberId !== member.userId) {
      setRemovingMemberId(member.userId);
      return;
    }
    setError("");
    try {
      await removeOrganizationMember(selected.id, member.userId);
      setMembers((current) => current.filter((candidate) => candidate.userId !== member.userId));
      setNotice("成员已移除。");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setRemovingMemberId(null);
    }
  }

  function updateManifest(update: (current: ClientManifestContent) => ClientManifestContent) {
    setManifest((current) => {
      const next = update(current);
      setAdvancedText(JSON.stringify(next, null, 2));
      setAdvancedError("");
      return next;
    });
  }

  function editAdvanced(value: string) {
    setAdvancedText(value);
    try {
      const parsed = JSON.parse(value) as ClientManifestContent;
      setManifest(parsed);
      setAdvancedError("");
    } catch {
      setAdvancedError("JSON 格式无效。");
    }
  }

  async function publish() {
    if (!selected) return;
    setError("");
    setNotice("");
    try {
      if (advancedError) throw new Error(advancedError);
      const content = JSON.parse(advancedText) as ClientManifestContent;
      const published = await publishOrganizationManifest(selected.id, content);
      setManifest(content);
      setManifestVersion(published.version);
      setNotice(`已发布版本 ${published.version}。`);
      await loadSession(false);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  if (loading && !session) {
    return (
      <main className="center-shell">
        <div className="center-card" role="status">
          正在检查登录状态…
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="login-shell">
        <form className="panel login-card" onSubmit={(event) => void login(event)}>
          <div>
            <h1>ericBot 管理控制台</h1>
            <p>平台管理员和企业管理员使用同一个界面。</p>
          </div>
          <label>
            邮箱
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="primary">
            登录
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            eB
          </span>
          <div>
            <p className="eyebrow">ericBot</p>
            <h1>管理控制台</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="role-chip">{session.platformAdmin ? "平台管理员" : "企业管理员"}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void fetch("/api/auth/sign-out", {
                method: "POST",
                credentials: "same-origin",
              }).then(() => setSession(null));
            }}
          >
            退出登录
          </button>
        </div>
      </header>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner success" role="status">
          {notice}
        </p>
      ) : null}

      <div className="admin-layout">
        <aside className="panel sidebar">
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>组织</h2>
            </div>
            <span className="count-badge">{session.organizations.length}</span>
          </div>

          {enterpriseOrganizations.length ? (
            <div className="org-group">
              <h3>企业组织</h3>
              <div className="org-list">
                {enterpriseOrganizations.map((organization) => (
                  <button
                    key={organization.id}
                    type="button"
                    className={organization.id === selectedId ? "selected" : ""}
                    aria-pressed={organization.id === selectedId}
                    onClick={() => void loadOrganization(organization)}
                  >
                    <span className="org-name">{organization.name}</span>
                    <span className="org-meta">
                      <span>{organization.slug}</span>
                      <span>{organization.memberCount} 位成员</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {personalOrganizations.length ? (
            <details
              className="personal-org-group"
              open={selected ? isPersonalOrganization(selected) : false}
            >
              <summary>
                <span>个人工作区</span>
                <span className="count-badge">{personalOrganizations.length}</span>
              </summary>
              <div className="org-list">
                {personalOrganizations.map((organization) => (
                  <button
                    key={organization.id}
                    type="button"
                    className={organization.id === selectedId ? "selected" : ""}
                    aria-pressed={organization.id === selectedId}
                    onClick={() => void loadOrganization(organization)}
                  >
                    <span className="org-name">{organization.name}</span>
                    <span className="org-meta">
                      <span>{organization.slug}</span>
                      <span>{organization.memberCount} 位成员</span>
                    </span>
                  </button>
                ))}
              </div>
            </details>
          ) : null}

          {!session.organizations.length ? <p>暂无可用组织。</p> : null}

          {session.platformAdmin ? (
            <details className="create-org">
              <summary>新建企业</summary>
              <form className="stack" onSubmit={(event) => void createOrg(event)}>
                <label>
                  企业名称
                  <input
                    placeholder="例如：Acme 中国"
                    value={orgName}
                    onChange={(event) => setOrgName(event.target.value)}
                    required
                  />
                </label>
                <label>
                  企业标识
                  <input
                    placeholder="acme-cn"
                    value={orgSlug}
                    onChange={(event) => setOrgSlug(event.target.value)}
                    required
                  />
                </label>
                <label>
                  所有者邮箱
                  <input
                    type="email"
                    placeholder="可选"
                    value={orgOwner}
                    onChange={(event) => setOrgOwner(event.target.value)}
                  />
                </label>
                <button type="submit" className="primary">
                  创建企业
                </button>
              </form>
            </details>
          ) : null}
        </aside>

        <section className="content">
          {selected ? (
            <>
              <header className="org-header panel">
                <div className="org-title">
                  <span className="org-kind">
                    {isPersonalOrganization(selected) ? "个人工作区" : "企业组织"}
                  </span>
                  <h2>{selected.name}</h2>
                  <p>{selected.slug}</p>
                </div>
                <span className={`version ${manifestVersion === null ? "pending" : "published"}`}>
                  {manifestVersion === null ? "尚未发布 Manifest" : `版本 ${manifestVersion}`}
                </span>
              </header>

              <section className="panel section-card">
                <div className="section-heading">
                  <div>
                    <h2>企业成员</h2>
                    <p>管理可访问该企业的账号与角色。</p>
                  </div>
                  <span className="count-badge">{members.length}</span>
                </div>
                <form className="member-form" onSubmit={(event) => void addMember(event)}>
                  <label>
                    邀请邮箱
                    <input
                      type="email"
                      placeholder="user@example.com"
                      autoComplete="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    角色
                    <select
                      value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value as "member" | "admin")}
                    >
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                  </label>
                  <button type="submit" className="primary">
                    添加成员
                  </button>
                </form>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>邮箱</th>
                        <th>角色</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.userId}>
                          <td className="member-name">{member.name}</td>
                          <td>{member.email}</td>
                          <td>
                            <span className="role-pill">{roleLabel(member.role)}</span>
                          </td>
                          <td className="row-actions">
                            <button
                              type="button"
                              className={
                                removingMemberId === member.userId
                                  ? "danger confirm"
                                  : "danger subtle"
                              }
                              aria-label={
                                removingMemberId === member.userId
                                  ? `确认移除 ${member.email}`
                                  : `移除 ${member.email}`
                              }
                              onClick={() => void removeMember(member)}
                            >
                              {removingMemberId === member.userId ? "确认移除" : "移除"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel section-card">
                <div className="section-heading">
                  <div>
                    <h2>企业资源</h2>
                    <p>知识库和技能会通过签名 Manifest 同步给企业成员。</p>
                  </div>
                  <button type="button" className="primary" onClick={() => void publish()}>
                    发布新版本
                  </button>
                </div>

                <ResourceSection
                  kind="knowledge"
                  entries={manifest.knowledge}
                  onAdd={() =>
                    updateManifest((current) => ({
                      ...current,
                      knowledge: [
                        ...current.knowledge,
                        { key: newKey("knowledge"), title: "新知识", content: "" },
                      ],
                    }))
                  }
                  onRemove={(index) =>
                    updateManifest((current) => ({
                      ...current,
                      knowledge: current.knowledge.filter((_, at) => at !== index),
                    }))
                  }
                  onChange={(index, patch) =>
                    updateManifest((current) => ({
                      ...current,
                      knowledge: current.knowledge.map((entry, at) =>
                        at === index ? { ...entry, ...patch } : entry,
                      ),
                    }))
                  }
                />

                <ResourceSection
                  kind="skills"
                  entries={manifest.skills}
                  onAdd={() =>
                    updateManifest((current) => ({
                      ...current,
                      skills: [
                        ...current.skills,
                        {
                          key: newKey("skill"),
                          name: "新技能",
                          description: "说明何时应使用这个技能。",
                          content:
                            "---\nname: 新技能\ndescription: 说明何时应使用这个技能。\n---\n\n步骤和说明。",
                          scripts: [],
                        },
                      ],
                    }))
                  }
                  onRemove={(index) =>
                    updateManifest((current) => ({
                      ...current,
                      skills: current.skills.filter((_, at) => at !== index),
                    }))
                  }
                  onChange={(index, patch) =>
                    updateManifest((current) => ({
                      ...current,
                      skills: current.skills.map((entry, at) =>
                        at === index ? { ...entry, ...patch } : entry,
                      ),
                    }))
                  }
                />

                <details className="advanced">
                  <summary>高级 Manifest JSON</summary>
                  <p>Bot 模板、群组、例行任务和功能策略可在这里编辑。</p>
                  <textarea
                    value={advancedText}
                    onChange={(event) => editAdvanced(event.target.value)}
                    spellCheck={false}
                  />
                  {advancedError ? <p className="error">{advancedError}</p> : null}
                </details>
              </section>
            </>
          ) : (
            <p>请选择一个企业组织。</p>
          )}
        </section>
      </div>
    </main>
  );
}

type ResourceEntry = {
  key: string;
  content: string;
  title?: string;
  name?: string;
  description?: string;
  scripts?: Array<{
    path: string;
    content: string;
    runtime: "node" | "python3" | "sh" | null;
    timeoutSeconds: number;
    network: boolean;
  }>;
};

function ResourceSection({
  kind,
  entries,
  onAdd,
  onRemove,
  onChange,
}: {
  kind: "knowledge" | "skills";
  entries: ResourceEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<ResourceEntry>) => void;
}) {
  const knowledge = kind === "knowledge";
  const title = knowledge ? "知识库" : "技能";
  return (
    <div className="resource-section">
      <div className="resource-heading">
        <div>
          <h3>{title}</h3>
          <p>
            {knowledge
              ? "企业共享的参考资料，成员客户端只读。"
              : "可复用的工作方法，可附带需要审批后执行的脚本。"}
          </p>
        </div>
        <button type="button" className="secondary" onClick={onAdd}>
          新增{title}
        </button>
      </div>
      {!entries.length ? (
        <div className="empty-state">
          <p>尚未发布企业{title}</p>
          <span>点击“新增{title}”开始配置，发布后会同步给企业成员。</span>
        </div>
      ) : null}
      {entries.map((entry, index) => (
        <div className="resource-card" key={`${entry.key}:${index}`}>
          <label>
            标识 Key
            <input
              value={entry.key}
              onChange={(event) => onChange(index, { key: event.target.value })}
            />
          </label>
          {knowledge ? (
            <label>
              标题
              <input
                value={entry.title ?? ""}
                onChange={(event) => onChange(index, { title: event.target.value })}
              />
            </label>
          ) : (
            <>
              <label>
                名称
                <input
                  value={entry.name ?? ""}
                  onChange={(event) => onChange(index, { name: event.target.value })}
                />
              </label>
              <label>
                说明
                <input
                  value={entry.description ?? ""}
                  onChange={(event) => onChange(index, { description: event.target.value })}
                />
              </label>
            </>
          )}
          <label>
            内容
            <textarea
              value={entry.content}
              onChange={(event) => onChange(index, { content: event.target.value })}
            />
          </label>
          {!knowledge ? (
            <div className="resource-scripts">
              <div className="title-row">
                <div>
                  <h4>可执行脚本</h4>
                  <p>脚本入口会由客户端 skill_run 在用户批准后执行。</p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    onChange(index, {
                      scripts: [
                        ...(entry.scripts ?? []),
                        {
                          path: "scripts/main.js",
                          content: "console.log(process.argv[2]);\n",
                          runtime: "node",
                          timeoutSeconds: 60,
                          network: false,
                        },
                      ],
                    })
                  }
                >
                  新增脚本
                </button>
              </div>
              {(entry.scripts ?? []).map((script, scriptIndex) => (
                <div className="script-card" key={`${script.path}:${scriptIndex}`}>
                  <div className="script-fields">
                    <label>
                      路径
                      <input
                        value={script.path}
                        onChange={(event) =>
                          onChange(index, {
                            scripts: (entry.scripts ?? []).map((candidate, at) =>
                              at === scriptIndex
                                ? { ...candidate, path: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      运行时
                      <select
                        value={script.runtime ?? ""}
                        onChange={(event) =>
                          onChange(index, {
                            scripts: (entry.scripts ?? []).map((candidate, at) =>
                              at === scriptIndex
                                ? {
                                    ...candidate,
                                    runtime:
                                      event.target.value === ""
                                        ? null
                                        : (event.target.value as "node" | "python3" | "sh"),
                                  }
                                : candidate,
                            ),
                          })
                        }
                      >
                        <option value="">辅助文件</option>
                        <option value="node">Node</option>
                        <option value="python3">Python 3</option>
                        <option value="sh">Shell</option>
                      </select>
                    </label>
                    <label>
                      超时（秒）
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={script.timeoutSeconds}
                        onChange={(event) =>
                          onChange(index, {
                            scripts: (entry.scripts ?? []).map((candidate, at) =>
                              at === scriptIndex
                                ? {
                                    ...candidate,
                                    timeoutSeconds: Math.min(
                                      120,
                                      Math.max(1, Number(event.target.value) || 1),
                                    ),
                                  }
                                : candidate,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={script.network}
                      onChange={(event) =>
                        onChange(index, {
                          scripts: (entry.scripts ?? []).map((candidate, at) =>
                            at === scriptIndex
                              ? { ...candidate, network: event.target.checked }
                              : candidate,
                          ),
                        })
                      }
                    />
                    允许联网
                  </label>
                  <label>
                    脚本内容
                    <textarea
                      value={script.content}
                      onChange={(event) =>
                        onChange(index, {
                          scripts: (entry.scripts ?? []).map((candidate, at) =>
                            at === scriptIndex
                              ? { ...candidate, content: event.target.value }
                              : candidate,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="danger align-start"
                    onClick={() =>
                      onChange(index, {
                        scripts: (entry.scripts ?? []).filter((_, at) => at !== scriptIndex),
                      })
                    }
                  >
                    删除脚本
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <button type="button" className="danger align-start" onClick={() => onRemove(index)}>
            删除
          </button>
        </div>
      ))}
    </div>
  );
}
