import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "app_auth";
const AUTH_COOKIE_VALUE = "true";

function buildMaintenanceHtml() {
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sito in manutenzione</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: radial-gradient(circle at 12% 8%, #f4f1e8 0%, transparent 40%), #f8f8f7;
        color: #222;
      }
      .card {
        width: min(92vw, 420px);
        border: 1px solid #dad8d0;
        border-radius: 16px;
        padding: 24px;
        background: #fff;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.08);
      }
      h1 { margin: 0 0 10px; font-size: 1.2rem; }
      p { margin: 0; color: #6a6a67; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>404 - Risorsa non disponibile</h1>
      <p>Il sito e temporaneamente in manutenzione. Riprova piu tardi.</p>
    </main>
  </body>
</html>`;
}

function isAuthorized(request: NextRequest) {
  return request.cookies.get(AUTH_COOKIE_NAME)?.value === AUTH_COOKIE_VALUE;
}

function isMagicKeyUnlock(request: NextRequest) {
  const secret = process.env.PERSONAL_SECRET_KEY;
  if (!secret) return false;

  if (request.nextUrl.pathname !== "/") return false;

  const incomingKey = request.nextUrl.searchParams.get("key");
  return incomingKey === secret;
}

function unlockResponse(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/";
  redirectUrl.searchParams.delete("key");

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: AUTH_COOKIE_VALUE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}

function maintenanceResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 404 });
  }

  return new NextResponse(buildMaintenanceHtml(), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function middleware(request: NextRequest) {
  if (isAuthorized(request)) {
    return NextResponse.next();
  }

  if (isMagicKeyUnlock(request)) {
    return unlockResponse(request);
  }

  return maintenanceResponse(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map)$).*)",
  ],
};
