import type { NextConfig } from "next";

// The API is core/api (`uvicorn core.api.main:app --port 8001`), which mounts every router
// under /api/v1 — so only that prefix is proxied, forwarded verbatim with no path remap.
//
// The prefix MUST stay narrow. `beforeFiles` rewrites run ahead of the filesystem router, so
// a blanket /api/:path* rule would swallow any route handler this app adds under src/app/api/
// and send it to FastAPI, which 404s it.
const API = process.env.API_URL || "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/api/v1/:path*/", destination: `${API}/api/v1/:path*/` },
        { source: "/api/v1/:path*", destination: `${API}/api/v1/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
