const REPOSITORY = "thunderwin/rakazo";
const RELEASE_TAG = "internal-latest";
const RELEASE_ROOT = `https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}`;

const files = {
  arm64: "ericBot-macos-arm64-unsigned.zip",
  x64: "ericBot-macos-x64-unsigned.zip",
  extension: "ericBot-browser-bridge.zip",
  checksums: "SHA256SUMS.txt",
} as const;

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

const worker = {
  fetch(request: Request, env: { ASSETS: AssetFetcher }): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/download/mac/arm64") {
      return Response.redirect(`${RELEASE_ROOT}/${files.arm64}`, 302);
    }
    if (url.pathname === "/download/mac/x64") {
      return Response.redirect(`${RELEASE_ROOT}/${files.x64}`, 302);
    }
    if (url.pathname === "/download/extension") {
      return Response.redirect(
        `https://github.com/${REPOSITORY}/releases/download/extension-latest/${files.extension}`,
        302,
      );
    }
    if (url.pathname === "/download/checksums") {
      return Response.redirect(`${RELEASE_ROOT}/${files.checksums}`, 302);
    }
    if (url.pathname === "/api/release") {
      return Response.json(
        {
          channel: "internal",
          repository: REPOSITORY,
          releases: { desktop: RELEASE_TAG, extension: "extension-latest" },
          files,
        },
        {
          headers: {
            "cache-control": "public, max-age=60, stale-while-revalidate=300",
          },
        },
      );
    }
    if (url.pathname === "/healthz") {
      return new Response("ok\n", {
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
