// src/capi.ts — Meta Conversions API (CAPI): gửi sự kiện Purchase khi chốt đơn.
// Mỗi shop 1 Pixel riêng, dùng token của chính shop đó. SĐT/tên/email băm SHA-256
// trước khi gửi. Không hard-code Pixel ID/token thật — lấy từ cấu hình shop.

import * as crypto from 'node:crypto';
import { GRAPH_BASE } from './meta.js';

export type CapiStatus = 'sent' | 'no_pixel' | 'failed' | 'not_configured';

export interface CapiConfig {
  pixelId?: string;
  accessToken?: string; // Conversions API access token của shop
  enabled?: boolean;
  testEventCode?: string;
}

export interface CapiPublicConfig {
  pixelIdMasked: string | null;
  hasToken: boolean;
  enabled: boolean;
  testEventCode?: string;
}

export interface PurchaseEventInput {
  pixelId: string;
  accessToken: string;
  orderCode: string; // event_id = mã đơn (chống trùng)
  phone?: string;
  name?: string;
  email?: string;
  value: number; // COD (VND)
  skus?: string[];
  eventTime?: number; // unix seconds, mặc định now
  testEventCode?: string;
  eventIdSuffix?: string; // vd '-resend-...' khi gửi lại
}

export interface CapiResult {
  ok: boolean;
  status: CapiStatus;
  message: string; // tiếng Việt, ghi vào capiLog trên đơn
  fbResponse?: unknown;
  eventsReceived?: number;
}

export function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Chuẩn hoá SĐT/tên/email trước khi băm theo quy định CAPI (lowercase, trim). */
function normUserData(phone?: string, name?: string, email?: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    const vn = digits.startsWith('84') ? digits : digits.startsWith('0') ? '84' + digits.slice(1) : digits;
    if (vn) out.ph = [sha256hex(vn)];
  }
  if (name) {
    const n = name.trim().toLowerCase();
    if (n) out.fn = [sha256hex(n)];
  }
  if (email) {
    const e = email.trim().toLowerCase();
    if (e) out.em = [sha256hex(e)];
  }
  return out;
}

/** Cấu hình CAPI trả về client: Pixel che, token chỉ báo có/không — không lộ giá trị thật. */
export function getCapiConfig(cfg?: CapiConfig | null): CapiPublicConfig {
  return {
    pixelIdMasked: cfg?.pixelId ? maskMiddle(cfg.pixelId) : null,
    hasToken: Boolean(cfg?.accessToken),
    enabled: cfg?.enabled !== false,
    testEventCode: cfg?.testEventCode,
  };
}

export function maskMiddle(v: string): string {
  if (v.length <= 8) return '****';
  return v.slice(0, 4) + '****' + v.slice(-4);
}

async function postEvents(
  pixelId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; body: any; httpStatus: number }> {
  const url = `${GRAPH_BASE}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: res.ok, body, httpStatus: res.status };
  } finally {
    clearTimeout(t);
  }
}

function buildPurchasePayload(input: PurchaseEventInput): Record<string, unknown> {
  const eventId = input.orderCode + (input.eventIdSuffix ?? '');
  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        user_data: normUserData(input.phone, input.name, input.email),
        custom_data: {
          value: input.value,
          currency: 'VND',
          content_ids: input.skus ?? [],
          content_type: 'product',
        },
      },
    ],
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  };
}

/** Gửi sự kiện Purchase cho 1 đơn đã chốt. Không throw — mọi lỗi trả về status 'failed'. */
export async function sendPurchaseEvent(input: PurchaseEventInput): Promise<CapiResult> {
  if (!input.pixelId || !input.accessToken) {
    return {
      ok: false,
      status: 'no_pixel',
      message: 'Chưa kết nối Pixel: shop chưa nhập Pixel ID hoặc Conversions API token nên đơn chưa được báo về Facebook.',
    };
  }
  try {
    const { ok, body, httpStatus } = await postEvents(input.pixelId, input.accessToken, buildPurchasePayload(input));
    if (!ok) {
      const msg = body?.error?.message ?? `Facebook trả lỗi HTTP ${httpStatus}.`;
      return {
        ok: false,
        status: 'failed',
        message: `Gửi Purchase về Facebook thất bại: ${msg}`,
        fbResponse: body,
      };
    }
    const received = typeof body?.events_received === 'number' ? body.events_received : undefined;
    return {
      ok: true,
      status: 'sent',
      message: received !== undefined
        ? `Đã báo đơn ${input.orderCode} về Facebook (Purchase, ${received} sự kiện nhận).`
        : `Đã báo đơn ${input.orderCode} về Facebook (Purchase).`,
      fbResponse: body,
      eventsReceived: received,
    };
  } catch (err: any) {
    return { ok: false, status: 'failed', message: `Gửi Purchase về Facebook thất bại: ${err?.message ?? String(err)}` };
  }
}

/** Gửi lại Purchase cho đơn (resendcapipurchase): giữ nguyên event_id = mã đơn để Facebook khử trùng. */
export async function resendPurchaseEvent(input: PurchaseEventInput): Promise<CapiResult> {
  return sendPurchaseEvent(input);
}

/**
 * Gửi sự kiện thử (sendcapitestevent): Purchase giá trị 0 kèm test_event_code
 * để chủ shop kiểm tra trong Events Manager > Test Events.
 */
export async function sendTestEvent(input: {
  pixelId: string;
  accessToken: string;
  testEventCode: string;
  value?: number;
}): Promise<CapiResult> {
  if (!input.testEventCode) {
    return { ok: false, status: 'failed', message: 'Thiếu test_event_code để gửi sự kiện thử.' };
  }
  const r = await sendPurchaseEvent({
    pixelId: input.pixelId,
    accessToken: input.accessToken,
    orderCode: 'TEST-' + Date.now(),
    value: input.value ?? 0,
    skus: [],
    testEventCode: input.testEventCode,
  });
  if (r.ok) r.message = 'Đã gửi sự kiện thử về Facebook. Kiểm tra trong Events Manager > Test Events.';
  return r;
}
