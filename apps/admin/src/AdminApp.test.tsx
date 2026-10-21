// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminApp } from "./AdminApp";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

it("shows the administrator login when there is no session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ error: "Authentication required" }, 401)),
  );
  root = createRoot(host);
  await act(async () => root?.render(<AdminApp />));
  await vi.waitFor(() => expect(host.textContent).toContain("ericBot 管理控制台"));
  expect(host.textContent).toContain("平台管理员和企业管理员使用同一个界面");
  expect(host.querySelector('input[type="email"]')).not.toBeNull();
});

it("loads organizations and structured enterprise resources", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/v1/admin/control/me")) {
        return response({
          userId: "admin-1",
          platformAdmin: true,
          organizations: [
            {
              id: "org-personal",
              name: "Personal",
              slug: "user-1",
              role: "owner",
              memberCount: 1,
              manifestVersion: null,
              manifestPublishedAt: null,
            },
            {
              id: "org-1",
              name: "ericBot 测试企业",
              slug: "ericbot-test",
              role: "platform_admin",
              memberCount: 2,
              manifestVersion: null,
              manifestPublishedAt: null,
            },
          ],
        });
      }
      if (path.endsWith("/members")) {
        return response({
          members: [
            {
              userId: "member-1",
              name: "测试成员",
              email: "member@example.com",
              role: "member",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (path.endsWith("/manifest")) return response({ manifest: null });
      return response({ error: "Not found" }, 404);
    }),
  );
  root = createRoot(host);
  await act(async () => root?.render(<AdminApp />));
  await vi.waitFor(() => expect(host.textContent).toContain("ericBot 测试企业"));
  expect(host.textContent).toContain("企业资源");
  expect(host.textContent).toContain("知识库");
  expect(host.textContent).toContain("技能");
  expect(host.textContent).toContain("新增知识库");
  expect(host.textContent).toContain("个人工作区");
  expect(host.textContent).toContain("发布新版本");
  expect(host.querySelector(".org-list button.selected")?.textContent).toContain(
    "ericBot 测试企业",
  );
  const remove = host.querySelector("tbody button") as HTMLButtonElement;
  await act(async () => remove.click());
  expect(remove.textContent).toBe("确认移除");
  expect(remove.getAttribute("aria-label")).toBe("确认移除 member@example.com");
});
