import type { AtprotoBlobRef, OAuthSession } from './types';

const PUBLIC_API = 'https://api.bsky.app';

const GET_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** HTTP statuses worth retrying (rate limits, overload, transient failures). */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export class XRPCError extends Error {
  constructor(
    public status: number,
    public errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'XRPCError';
  }
}

let oauthSession: OAuthSession | null = null;

export function setOAuthSession(session: OAuthSession | null) {
  oauthSession = session;
}

export function getOAuthSession(): OAuthSession | null {
  return oauthSession;
}

export async function xrpcGet<T>(
  nsid: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, PUBLIC_API);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const urlStr = url.toString();

  for (let attempt = 0; attempt < GET_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(urlStr, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });

      if (res.ok) {
        return res.json();
      }

      if (isTransientStatus(res.status) && attempt < GET_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }

      let errorType = 'Unknown';
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        errorType = body.error || errorType;
        message = body.message || message;
      } catch {
        // Response wasn't JSON (e.g. HTML error page from CDN)
      }
      throw new XRPCError(res.status, errorType, message);
    } catch (e) {
      if (e instanceof XRPCError) throw e;
      if (attempt < GET_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  throw new Error('Request failed');
}

/** Authenticated GET (timeline, notifications, etc.) — uses OAuth session + PDS. */
export async function xrpcSessionGet<T>(
  nsid: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  if (!oauthSession) {
    throw new XRPCError(401, 'AuthRequired', 'You must be signed in to do this');
  }

  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
  }
  const path = `/xrpc/${nsid}${qs.toString() ? `?${qs.toString()}` : ''}`;

  for (let attempt = 0; attempt < GET_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await oauthSession.fetchHandler(path, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok) {
        return res.json();
      }

      if (isTransientStatus(res.status) && attempt < GET_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }

      let errorType = 'Unknown';
      let message = res.statusText;
      try {
        const data = await res.json();
        errorType = data.error || errorType;
        message = data.message || message;
      } catch { /* empty */ }
      throw new XRPCError(res.status, errorType, message);
    } catch (e) {
      if (e instanceof XRPCError) throw e;
      if (attempt < GET_MAX_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  throw new Error('Request failed');
}

export async function xrpcPost<T>(
  nsid: string,
  body: unknown,
): Promise<T> {
  if (!oauthSession) {
    throw new XRPCError(401, 'AuthRequired', 'You must be signed in to do this');
  }

  // OAuthSession.fetchHandler takes a pathname and resolves it against the
  // user's PDS URL from the token set. It also handles DPoP signing and
  // automatic token refresh.
  const res = await oauthSession.fetchHandler(`/xrpc/${nsid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorType = 'Unknown';
    let message = res.statusText;
    try {
      const data = await res.json();
      errorType = data.error || errorType;
      message = data.message || message;
    } catch {}
    throw new XRPCError(res.status, errorType, message);
  }
  return res.json();
}

/** Upload raw bytes to the user's PDS (`com.atproto.repo.uploadBlob`). */
export async function xrpcUploadBlob(
  body: ArrayBuffer,
  mimeType: string,
): Promise<{ blob: AtprotoBlobRef }> {
  if (!oauthSession) {
    throw new XRPCError(401, 'AuthRequired', 'You must be signed in to do this');
  }

  const res = await oauthSession.fetchHandler(`/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { 'Content-Type': mimeType },
    body,
  });

  if (!res.ok) {
    let errorType = 'Unknown';
    let message = res.statusText;
    try {
      const data = await res.json();
      errorType = data.error || errorType;
      message = data.message || message;
    } catch { /* empty */ }
    throw new XRPCError(res.status, errorType, message);
  }

  return res.json();
}
