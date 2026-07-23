import type { BrowserCookie } from "./types";

type CdpResponse = {
  id?: number;
  error?: { message?: string };
  result?: { cookies?: BrowserCookie[] };
};

export async function readYoutubeAuthCookies(websocketUrl: string): Promise<BrowserCookie[]> {
  const response = await sendCdpCommand(websocketUrl, "Storage.getCookies");
  return response.result?.cookies ?? [];
}

export async function closeYoutubeAuthBrowser(websocketUrl: string) {
  try {
    await sendCdpCommand(websocketUrl, "Browser.close", 1_500);
  } catch {
    // The browser normally closes the socket before acknowledging Browser.close.
  }
}

export function hasAuthenticatedYoutubeCookies(cookies: BrowserCookie[]) {
  const accountCookies = new Set([
    "SAPISID",
    "__Secure-1PAPISID",
    "__Secure-3PAPISID",
    "LOGIN_INFO",
  ]);
  return cookies.some((cookie) => {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    return (
      (domain === "youtube.com" || domain.endsWith(".youtube.com")) &&
      accountCookies.has(cookie.name) &&
      cookie.value.length > 0
    );
  });
}

function sendCdpCommand(websocketUrl: string, method: string, timeoutMs = 4_000) {
  return new Promise<CdpResponse>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    const requestId = 1;
    let settled = false;
    const timer = window.setTimeout(() => {
      finish(new Error("CDP timeout"));
    }, timeoutMs);

    const finish = (result: CdpResponse | Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      socket.close();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: requestId, method }));
      if (method === "Browser.close") {
        window.setTimeout(() => finish({ id: requestId, result: {} }), 150);
      }
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as CdpResponse;
        if (message.id !== requestId) return;
        if (message.error) {
          finish(new Error(message.error.message ?? "CDP error"));
          return;
        }
        finish(message);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.addEventListener("error", () => finish(new Error("CDP connection failed")));
  });
}
