// src/meta.ts — Meta Graph API + Messenger Send API + OAuth + webhook verify.
// AChatGo standalone (v37). Không hard-code token/khóa thật: mọi token lấy từ
// state (cấu hình shop) hoặc tham số truyền vào. Lỗi Facebook trả nguyên văn.

import * as crypto from 'node:crypto';

export const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
export const OAUTH_DIALOG_BASE = 'https://www.facebook.com/v19.0/dialog/oauth';

// 6 quyền xin khi kết nối Meta (Cách 1: 1 Meta App chung, token theo từng shop).
export const META_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
] as const;

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: number | string; fbError?: unknown };

export interface PixelInfo {
  id: string;
  name?: string;
  accountId?: string;
}

export interface PageInfo {
  id: string;
  name?: string;
  access_token?: string;
  category?: string;
}

function fbErrorMessage(body: any, fallback: string): string {
  const e = body?.error;
  if (e && typeof e.message === 'string') {
    // Giữ nguyên văn mã + thông điệp Facebook (vd: (#100), (#10) subcode 2018300).
    const code = e.code !== undefined ? ` (${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})` : '';
    return `${e.message}${code}`;
  }
  return fallback;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 30000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) return { __httpError: true, status: res.status, body };
    return body;
  } finally {
    clearTimeout(t);
  }
}

function withToken(url: string, accessToken: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(accessToken)}`;
}

/** GET Graph API. Trả { ok:false, error } với thông điệp Facebook nguyên văn khi lỗi. */
export async function graphGet<T = any>(
  path: string,
  accessToken: string,
  params?: Record<string, string>,
): Promise<GraphResult<T>> {
  if (!accessToken) return { ok: false, error: 'Thiếu access token Facebook.' };
  const query = new URLSearchParams(params ?? {});
  query.set('access_token', accessToken);
  const url = `${GRAPH_BASE}${path.startsWith('/') ? path : '/' + path}?${query.toString()}`;
  try {
    const body = await fetchJson(url, { method: 'GET' });
    if (body?.__httpError) {
      return { ok: false, error: fbErrorMessage(body.body, `Facebook trả lỗi HTTP ${body.status}.`), code: body.body?.error?.code, fbError: body.body };
    }
    return { ok: true, data: body as T };
  } catch (err: any) {
    return { ok: false, error: `Không gọi được Graph API: ${err?.message ?? String(err)}` };
  }
}

/** POST Graph API (JSON body). */
export async function graphPost<T = any>(
  path: string,
  accessToken: string,
  body: Record<string, unknown> = {},
): Promise<GraphResult<T>> {
  if (!accessToken) return { ok: false, error: 'Thiếu access token Facebook.' };
  const url = withToken(`${GRAPH_BASE}${path.startsWith('/') ? path : '/' + path}`, accessToken);
  try {
    const res = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res?.__httpError) {
      return { ok: false, error: fbErrorMessage(res.body, `Facebook trả lỗi HTTP ${res.status}.`), code: res.body?.error?.code, fbError: res.body };
    }
    return { ok: true, data: res as T };
  } catch (err: any) {
    return { ok: false, error: `Không gọi được Graph API: ${err?.message ?? String(err)}` };
  }
}

/** Gửi tin text Messenger qua Send API bằng page token. */
export async function sendMessengerMessage(
  pageAccessToken: string,
  psid: string,
  text: string,
): Promise<GraphResult<{ message_id: string }>> {
  if (!pageAccessToken) return { ok: false, error: 'Page chưa kết nối (thiếu page token).' };
  if (!psid) return { ok: false, error: 'Thiếu PSID người nhận.' };
  return graphPost<{ message_id: string }>('/me/messages', pageAccessToken, {
    recipient: { id: psid },
    message: { text },
    messaging_type: 'RESPONSE',
  });
}

/** Gửi ảnh Messenger qua Send API bằng page token (image_url công khai). */
export async function sendMessengerImage(
  pageAccessToken: string,
  psid: string,
  imageUrl: string,
): Promise<GraphResult<{ message_id: string }>> {
  if (!pageAccessToken) return { ok: false, error: 'Page chưa kết nối (thiếu page token).' };
  if (!psid) return { ok: false, error: 'Thiếu PSID người nhận.' };
  if (!imageUrl) return { ok: false, error: 'Thiếu URL ảnh.' };
  return graphPost<{ message_id: string }>('/me/messages', pageAccessToken, {
    recipient: { id: psid },
    message: {
      attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } },
    },
    messaging_type: 'RESPONSE',
  });
}

/**
 * Liệt kê Pixel của shop: /me/adaccounts -> /{act}/adspixels,
 * rồi vòng qua Business (/me/businesses -> /{biz}/owned_ad_accounts -> adspixels)
 * vì token thiếu ads_management/ads_read sẽ bị Meta giấu lỗi sau mã #100.
 */
export async function listShopPixels(userAccessToken: string): Promise<GraphResult<PixelInfo[]>> {
  if (!userAccessToken) return { ok: false, error: 'Thiếu user access token.' };
  const pixels: PixelInfo[] = [];
  const seen = new Set<string>();

  const collectFromAccount = async (actId: string): Promise<void> => {
    const r = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(
      `/${actId}/adspixels`,
      userAccessToken,
      { fields: 'id,name' },
    );
    if (r.ok && Array.isArray(r.data?.data)) {
      for (const p of r.data.data) {
        if (p?.id && !seen.has(p.id)) {
          seen.add(p.id);
          pixels.push({ id: p.id, name: p.name, accountId: actId });
        }
      }
    }
  };

  const adaccounts = await graphGet<{ data?: Array<{ id: string; name?: string }> }>(
    '/me/adaccounts',
    userAccessToken,
    { fields: 'id,name' },
  );
  if (adaccounts.ok && Array.isArray(adaccounts.data?.data)) {
    for (const a of adaccounts.data.data) if (a?.id) await collectFromAccount(a.id);
  } else if (!adaccounts.ok) {
    // /me/adaccounts lỗi (thường do thiếu quyền) -> thử vòng qua Business rồi mới báo lỗi.
    const biz = await graphGet<{ data?: Array<{ id: string }> }>('/me/businesses', userAccessToken, { fields: 'id,name' });
    if (biz.ok && Array.isArray(biz.data?.data)) {
      for (const b of biz.data?.data ?? []) {
        const owned = await graphGet<{ data?: Array<{ id: string }> }>(`/${b.id}/owned_ad_accounts`, userAccessToken, { fields: 'id' });
        if (owned.ok && Array.isArray(owned.data?.data)) {
          for (const a of owned.data.data) if (a?.id) await collectFromAccount(a.id);
        }
      }
    }
    if (pixels.length === 0) {
      return {
        ok: false,
        error: `Không liệt kê được Pixel: ${adaccounts.error} Nếu token thiếu quyền ads_management/ads_read, chủ shop cần đăng nhập lại qua "Kết nối tài khoản Meta" và cấp đủ quyền.`,
        code: adaccounts.code,
        fbError: adaccounts.fbError,
      };
    }
  }

  if (pixels.length === 0) {
    const biz = await graphGet<{ data?: Array<{ id: string }> }>('/me/businesses', userAccessToken, { fields: 'id,name' });
    if (biz.ok && Array.isArray(biz.data?.data)) {
      for (const b of biz.data?.data ?? []) {
        const owned = await graphGet<{ data?: Array<{ id: string }> }>(`/${b.id}/owned_ad_accounts`, userAccessToken, { fields: 'id' });
        if (owned.ok && Array.isArray(owned.data?.data)) {
          for (const a of owned.data.data) if (a?.id) await collectFromAccount(a.id);
        }
      }
    }
  }
  return { ok: true, data: pixels };
}

/** URL đăng nhập Facebook OAuth (Accounts Center): xin đúng 6 quyền. */
export function buildOAuthUrl(opts: {
  appId: string;
  redirectUri: string;
  state?: string;
  scopes?: string[];
}): string {
  const q = new URLSearchParams({
    client_id: opts.appId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: (opts.scopes ?? [...META_SCOPES]).join(','),
  });
  if (opts.state) q.set('state', opts.state);
  return `${OAUTH_DIALOG_BASE}?${q.toString()}`;
}

/**
 * Verify chữ ký webhook Facebook: header X-Hub-Signature-256 = 'sha256=<hex HMAC-SHA256(rawBody, appSecret)>'.
 * rawBody phải là body thô (chuỗi/Buffer) chưa qua JSON.parse.
 */
export function verifyWebhookSignature(
  appSecret: string,
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Đổi code OAuth lấy user access token (dùng trong exchangeoauthcode). */
export async function exchangeCodeForToken(opts: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GraphResult<{ access_token: string; token_type?: string; expires_in?: number }>> {
  const q = new URLSearchParams({
    client_id: opts.appId,
    client_secret: opts.appSecret,
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  try {
    const body = await fetchJson(`${GRAPH_BASE}/oauth/access_token?${q.toString()}`, { method: 'GET' });
    if (body?.__httpError) {
      return { ok: false, error: fbErrorMessage(body.body, `Facebook trả lỗi HTTP ${body.status} khi đổi code.`), code: body.body?.error?.code, fbError: body.body };
    }
    return { ok: true, data: body };
  } catch (err: any) {
    return { ok: false, error: `Không đổi được code OAuth: ${err?.message ?? String(err)}` };
  }
}

/** Lấy danh sách Page user quản lý kèm page token (/me/accounts). */
export async function listManagedPages(userAccessToken: string): Promise<GraphResult<PageInfo[]>> {
  const r = await graphGet<{ data?: PageInfo[] }>('/me/accounts', userAccessToken, {
    fields: 'id,name,access_token,category',
  });
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.data?.data) ? r.data.data : [] };
}
