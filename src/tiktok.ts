// src/tiktok.ts — TikTok Shop Open API (bản 202309) + map đơn/SP về AChatGo.
//
// NGUỒN ĐÃ KIỂM CHỨNG (2026-11-10, từ tài liệu công khai + client mã nguồn mở
// EcomPHP/tiktokshop-php bản 202309 — KHÔNG dùng dữ liệu thật):
//   - Host: auth.tiktok-shops.com (token) / open-api.tiktokglobalshop.com (API)
//     / services.tiktokshop.com (authorize, thị trường ngoài US).
//   - Đổi code: GET /api/v2/token/get?app_key&app_secret&auth_code&grant_type=authorized_code
//     (KHÔNG ký; app_secret đi trong query; code 30 phút, dùng 1 lần).
//   - Refresh: GET /api/v2/token/refresh?app_key&app_secret&refresh_token&grant_type=refresh_token.
//     Trả access_token + refresh_token MỚI (cả hai đều phải lưu lại).
//   - access_token_expire_in / refresh_token_expire_in là TIMESTAMP TUYỆT ĐỐI (Unix giây),
//     KHÔNG phải số giây cộng thêm — so trực tiếp với thời gian hiện tại.
//   - Ký request: sắp xếp query (trừ sign/access_token/x-tts-access-token) theo
//     alphabet, nối {key}{value} không phân cách, thêm path lên trước, thêm body
//     JSON nguyên văn (POST), bọc bằng app_secret 2 đầu, HMAC-SHA256 bằng
//     app_secret làm key, hex. Ví dụ kiểm chứng (từ tài liệu):
//     secret e59af819cc, path /authorization/202309/shops, app_key=29a39d,
//     timestamp=1623812664 -> chuỗi ký
//     "e59af819cc/authorization/202309/shopsapp_key29a39dtimestamp1623812664e59af819cc"
//     -> sign b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8.
//   - Token đi trong header x-tts-access-token; shop_cipher đi trong query.
//   - Mọi response đều bọc {code, message, request_id, data}; code 0 mới là thành
//     công (HTTP 200 vẫn có thể là lỗi nghiệp vụ). Lỗi hay gặp: 36009002 rate limit,
//     105005 thiếu scope, 106013 thiếu shop_cipher, 36009004 shop_cipher không cần,
//     40001 chữ ký sai, 36004004 auth_code hết hạn/dùng lại.
//   - Webhook: header Authorization = HMAC-SHA256(app_secret, app_key + raw_body),
//     hex, so sánh bằng timingSafeEqual. Body {type, shop_id, timestamp, data}.
//     Event type đã xác nhận trong client nguồn: ORDER_STATUS_UPDATE. Các type khác
//     (ORDER_STATUS_CHANGE, PACKAGE_UPDATE, RECIPIENT_ADDRESS_UPDATE,
//     PRODUCT_STATUS_CHANGE, SELLER_DEAUTHORIZATION, NEW_MESSAGE) theo kế hoạch
//     khảo sát + Partner Center — CẦN XÁC NHẬN lại tên type đúng trong Partner
//     Center khi đăng ký webhook (code nhận cả 2 tên cho trạng thái đơn).
//   - Đơn: POST /order/202309/orders/search (page_size/page_token query; body lọc
//     theo order_status / create_time / update_time — đồng bộ tăng dần thì lọc
//     theo update_time). line_items: MỘT entry = MỘT chiếc (không có trường số
//     lượng) → gộp theo sku_id. Tiền là chuỗi thập phân; địa chỉ/SĐT người nhận
//     CÓ THỂ BỊ CHE (tên "J*** D***") khi chưa xin quyền dữ liệu nhạy cảm.
//   - SP: POST /product/202309/products/search; GET /product/202309/products/{id};
//     POST /product/202309/inventory/search; POST .../products/{id}/prices/update;
//     POST .../products/{id}/inventory/update (số lượng TUYỆT ĐỐI, theo kho).
//   - Hoàn/trả: POST /return_refund/202309/returns/search,
//     /return_refund/202309/cancellations/search, .../returns/approve,
//     .../returns/reject, .../refunds/calculate.
//   - Tài chính: GET /finance/202309/statements,
//     GET /finance/202309/statements/{id}/statement_transactions,
//     GET /finance/202309/payments (HIỆN KHÔNG DÙNG ĐƯỢC Ở THỊ TRƯỜNG ĐÔNG NAM Á
//     theo Partner Center — code bắt lỗi và báo cảnh báo thay vì fail),
//     GET /finance/202309/withdrawals.
//   - Webhook đăng ký: PUT /event/202309/webhooks {address, event_type}.
//   - Trạng thái đơn: UNPAID, ON_HOLD, AWAITING_SHIPMENT, PARTIALLY_SHIPPING,
//     AWAITING_COLLECTION, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED.
//   - Scope (bật ĐỦ ngay từ đầu — thêm scope sau bắt mọi seller ủy quyền lại):
//     seller.authorization.info (bắt buộc), seller.shop.info, seller.order.info,
//     seller.product.basic, seller.product.write, seller.fulfillment.basic,
//     seller.logistics.basic, seller.return_refund.basic, seller.finance.info,
//     seller.promotion.info. Customer Service + Product Reviews do TikTok cấp
//     theo yêu cầu, không bật bằng công tắc — code chỉ nhắn tin khi scope đã
//     được cấp (kiểm tra granted_scopes lúc chạy, không giả định có).
//
// QUY TẮC BẮT BUỘC (theo conventions của repo):
//   - KHÔNG hard-code app_key/app_secret/service_id/token thật: app chung lấy
//     từ State.tiktokPlatform (Super Admin nhập 1 lần), token lấy từ cấu
//     hình shop (ShopExt.tiktok). File này chỉ chứa endpoint/scope/thuật toán.
//   - Không bịa kết quả: lỗi TikTok trả nguyên văn (code + message).
//   - Tiền VND: TikTok trả chuỗi thập phân — parse rồi làm tròn số nguyên.
//   - Đơn sàn đi logistics của sàn, KHÔNG đẩy qua GHN/GHTK như đơn Facebook;
//     đơn TikTok không gửi CAPI Purchase về Facebook.

import * as crypto from 'node:crypto';
import { maskSecret, nextOrderCode } from './auth.js';
import type { Order, OrderItem, OrderStatus, State, TikTokPlatformConfig } from './types.js';

export const TIKTOK_AUTH_HOST = 'https://auth.tiktok-shops.com';
export const TIKTOK_API_HOST = 'https://open-api.tiktokglobalshop.com';
export const TIKTOK_AUTHORIZE_HOST = 'https://services.tiktokshop.com';
export const TIKTOK_API_VERSION = '202309';

/** Scope bật đủ ngay từ đầu cho app TikTok Shop (xem ghi chú đầu file). */
export const TIKTOK_SCOPES: Array<{ key: string; label: string }> = [
  { key: 'seller.authorization.info', label: 'Thông tin ủy quyền shop (bắt buộc)' },
  { key: 'seller.shop.info', label: 'Thông tin shop' },
  { key: 'seller.order.info', label: 'Đơn hàng + giá' },
  { key: 'seller.product.basic', label: 'Sản phẩm / SKU / tồn kho (đọc)' },
  { key: 'seller.product.write', label: 'Sửa giá / tồn kho sản phẩm' },
  { key: 'seller.fulfillment.basic', label: 'Gói hàng / vận chuyển' },
  { key: 'seller.logistics.basic', label: 'Kho hàng / logistics' },
  { key: 'seller.return_refund.basic', label: 'Hoàn hàng / trả hàng' },
  { key: 'seller.finance.info', label: 'Đối soát tiền về' },
  { key: 'seller.promotion.info', label: 'Khuyến mãi' },
];

/** Scope tối thiểu để kết nối (TikTok bắt buộc). */
export const TIKTOK_REQUIRED_SCOPE = 'seller.authorization.info';

/** Trạng thái đơn TikTok (202309) — map sang 8 bước của app ở mapTikTokOrderStatus. */
export const TIKTOK_ORDER_STATUSES = [
  'UNPAID',
  'ON_HOLD',
  'AWAITING_SHIPMENT',
  'PARTIALLY_SHIPPING',
  'AWAITING_COLLECTION',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TikTokResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: number | string };

/** Dữ liệu token TikTok trả về (expiry là timestamp tuyệt đối, giây). */
export interface TikTokTokenData {
  access_token: string;
  access_token_expire_in: number;
  refresh_token: string;
  refresh_token_expire_in: number;
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
  user_type?: string;
  granted_scopes?: string[];
}

/** Cấu hình + token TikTok của một shop (lưu ở ShopExt.tiktok — xem actions.ts).
 *  MÔ HÌNH ACHAT (đổi 2026-11-10): app_key/app_secret/service_id/redirectUri/
 *  webhookUrl KHÔNG còn ở từng shop — 1 app chung của cả nền tảng nằm ở
 *  State.tiktokPlatform (chỉ Super Admin nhập). Shop chỉ giữ token + trạng
 *  thái ủy quyền của riêng mình. */
export interface TikTokShopConfig {
  /** Trạng thái kết nối. */
  status: 'disconnected' | 'connected' | 'expired' | 'revoked';
  /** Cipher của shop đã ủy quyền (lấy qua GET /authorization/202309/shops). */
  shopCipher?: string;
  /** Id số của shop (webhook gửi shop_id này). */
  shopId?: string;
  shopName?: string;
  /** Access token — KHÔNG BAO GIỜ trả về client. */
  accessToken?: string;
  /** Refresh token — KHÔNG BAO GIỜ trả về client. */
  refreshToken?: string;
  /** Hạn access token (timestamp tuyệt đối, giây). */
  accessTokenExpiresAt?: number;
  /** Hạn refresh token (timestamp tuyệt đối, giây). */
  refreshTokenExpiresAt?: number;
  /** Scope seller đã cấp (lấy từ token response). */
  grantedScopes?: string[];
  /** true = scope chat khách đã được TikTok cấp (kiểm tra lúc chạy). */
  chatScopeGranted?: boolean;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
  /** Cảnh báo sắp hết hạn ủy quyền (từ webhook AUTHORIZATION_EXPIRY). */
  authExpiryWarning?: string;
}

/** App TikTok chung trả về client — appSecret KHÔNG BAO GIỜ ra ngoài, appKey đã che. */
export function tiktokPlatformPublic(cfg: TikTokPlatformConfig | undefined | null): Record<string, unknown> {
  return {
    appKey: cfg?.appKey ? maskSecret(cfg.appKey) : '',
    hasAppSecret: Boolean(cfg?.appSecret),
    serviceId: cfg?.serviceId ?? '',
    redirectUri: cfg?.redirectUri ?? '',
    webhookUrl: cfg?.webhookUrl ?? '',
    authorizeHost: cfg?.authorizeHost ?? '',
    apiVersion: cfg?.apiVersion || '202309',
    configured: Boolean(cfg?.appKey && cfg?.appSecret && cfg?.serviceId),
    updatedAt: cfg?.updatedAt ?? null,
  };
}

/** true = app TikTok chung đã nhập đủ app_key/app_secret/service_id. */
export function tiktokPlatformConfigured(cfg: TikTokPlatformConfig | undefined | null): boolean {
  return Boolean(cfg?.appKey && cfg?.appSecret && cfg?.serviceId);
}

/** Một dòng map SKU nội bộ ↔ SKU TikTok. */
export interface TikTokSkuMap {
  id: string;
  shopKey: string;
  /** SKU biến thể nội bộ (vd DQN-DEN-37). */
  internalSku: string;
  productId: string;
  skuId: string;
  /** Tên SP trên TikTok (để đối chiếu). */
  productName?: string;
  /** Tên biến thể trên TikTok (vd "Đen, 37"). */
  skuName?: string;
  /** Tồn kho TikTok mới nhất (tổng các kho). */
  tiktokStock?: number;
  /** Kho TikTok dùng khi đẩy tồn kho (lấy từ inventory TikTok). */
  warehouseId?: string;
  syncedAt?: string;
  createdAt: string;
}

/** Một dòng đối soát tài chính TikTok (statement / transaction / payment / withdrawal). */
export interface TikTokFinanceRecord {
  id: string;
  shopKey: string;
  kind: 'statement' | 'transaction' | 'payment' | 'withdrawal';
  /** Id của statement/transaction/payment trên TikTok. */
  platformId: string;
  /** Mã đơn TikTok (chỉ transaction theo đơn). */
  platformOrderId?: string;
  /** Mã đơn AChatGo đã khớp (nếu có). */
  orderCode?: string;
  /** Số tiền (đồng, đã quy đổi từ chuỗi thập phân). */
  amount: number;
  /** Loại tiền gốc (vd VND). */
  currency?: string;
  /** Chi tiết phí (commission / affiliate / transaction / shipping...). */
  fees?: Array<{ type: string; amount: number }>;
  status?: string;
  /** Thời gian phát sinh (ISO). */
  at?: string;
  raw?: Record<string, unknown>;
}

/** Một yêu cầu hoàn/trả/hủy trên TikTok. */
export interface TikTokReturnRecord {
  id: string;
  shopKey: string;
  /** Id return/cancellation trên TikTok. */
  platformReturnId: string;
  platformOrderId: string;
  /** Mã đơn AChatGo đã khớp (nếu có). */
  orderCode?: string;
  kind: 'return' | 'cancellation';
  /** Trạng thái gốc TikTok (giữ nguyên văn). */
  status: string;
  returnType?: string;
  reason?: string;
  /** Số tiền hoàn (đồng). */
  refundAmount?: number;
  currency?: string;
  /** Id phiếu trả hàng trong app (ReturnSlipExt) nếu đã tạo. */
  returnSlipId?: string;
  at?: string;
  updatedAt?: string;
}

/** Một event webhook TikTok đã nhận (lưu để dedupe + kiểm tra lại). */
export interface TikTokWebhookEvent {
  id: string;
  shopKey: string;
  /** Khóa dedupe: hash của raw body (TikTok không gửi tts_notification_id ở 202309). */
  dedupeKey: string;
  eventType: string;
  shopId?: string;
  platformOrderId?: string;
  receivedAt: string;
  /** 'stored' | 'processed' | 'failed' | 'ignored' (type không hỗ trợ / thiếu scope). */
  status: string;
  note?: string;
  payload?: Record<string, unknown>;
}

/** Một tin nhắn gửi cho khách TikTok (chỉ khi scope chat được cấp). */
export interface TikTokMessage {
  id: string;
  shopKey: string;
  conversationId: string;
  text: string;
  at: string;
  by?: string;
  /** 'sent' | 'failed'. */
  status: string;
  error?: string;
}

function tiktokUid(prefix = 'tt'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function tiktokNowIso(): string {
  return new Date().toISOString();
}

function tiktokErrorMessage(body: any, fallback: string): string {
  const code = body?.code;
  const msg = typeof body?.message === 'string' ? body.message : '';
  if (code !== undefined && code !== 0) {
    // Giữ nguyên văn mã + thông điệp TikTok (vd 36009002 rate limit, 105005 thiếu scope).
    return `TikTok trả lỗi ${code}${msg ? `: ${msg}` : ''}.`;
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

// ---------------------------------------------------------------------------
// Ký request (thuật toán đã kiểm chứng — xem ghi chú đầu file + ví dụ mẫu)
// ---------------------------------------------------------------------------

/**
 * Ký request TikTok Shop: sort query (trừ sign/access_token/x-tts-access-token),
 * nối {key}{value}, thêm path, thêm body JSON nguyên văn (POST), bọc app_secret
 * 2 đầu, HMAC-SHA256 bằng app_secret làm key, hex.
 * Trả { sign, timestamp } (timestamp giây, 10 chữ số).
 */
export function signTikTokRequest(
  appSecret: string,
  path: string,
  queryParams: Record<string, string>,
  bodyString?: string,
  timestampOverride?: number,
): { sign: string; timestamp: string } {
  const timestamp = String(timestampOverride ?? Math.floor(Date.now() / 1000));
  const params: Record<string, string> = { ...queryParams, timestamp };
  delete params.sign;
  delete params.access_token;
  delete params['x-tts-access-token'];
  const sorted = Object.keys(params).sort();
  let base = path;
  for (const k of sorted) base += `${k}${params[k]}`;
  if (bodyString) base += bodyString;
  const toSign = `${appSecret}${base}${appSecret}`;
  const sign = crypto.createHmac('sha256', appSecret).update(toSign, 'utf8').digest('hex');
  return { sign, timestamp };
}

// ---------------------------------------------------------------------------
// OAuth: authorize URL + đổi code + refresh token
// ---------------------------------------------------------------------------

/** Link ủy quyền seller (Global; US dùng services.us.tiktokshop.com). authorizeHost rỗng = dùng host Global mặc định. */
export function buildTikTokAuthorizeUrl(opts: {
  serviceId: string;
  state?: string;
  authorizeHost?: string;
}): string {
  const host = (opts.authorizeHost || TIKTOK_AUTHORIZE_HOST).replace(/\/$/, '');
  const q = new URLSearchParams({ service_id: opts.serviceId });
  if (opts.state) q.set('state', opts.state);
  return `${host}/open/authorize?${q.toString()}`;
}

/** Trạng thái OAuth (state nonce) — chống CSRF cho callback. Lưu trong bộ nhớ, hết hạn 10 phút. */
const pendingAuthStates = new Map<string, { shopKey: string; createdAt: number }>();

export function createTikTokAuthState(shopKey: string): string {
  const nonce = crypto.randomBytes(12).toString('hex');
  const state = `${shopKey}:${nonce}`;
  pendingAuthStates.set(state, { shopKey, createdAt: Date.now() });
  return state;
}

/** Đổi state callback lấy shopKey; null khi state lạ/hết hạn (chống CSRF). */
export function consumeTikTokAuthState(stateParam: string): string | null {
  const rec = pendingAuthStates.get(stateParam);
  if (!rec) return null;
  pendingAuthStates.delete(stateParam);
  if (Date.now() - rec.createdAt > 10 * 60 * 1000) return null;
  return rec.shopKey;
}

function parseTokenResponse(body: any): TikTokResult<TikTokTokenData> {
  if (body?.__httpError) {
    return { ok: false, error: `TikTok trả lỗi HTTP ${body.status} khi đổi token.`, code: body.status };
  }
  if (body?.code !== 0 || !body?.data?.access_token) {
    return { ok: false, error: tiktokErrorMessage(body, 'Đổi token TikTok thất bại (không rõ lý do).'), code: body?.code };
  }
  return { ok: true, data: body.data as TikTokTokenData };
}

/** Đổi auth_code (30 phút, 1 lần) lấy access + refresh token. KHÔNG ký request này. */
export async function exchangeAuthCode(opts: {
  appKey: string;
  appSecret: string;
  authCode: string;
}): Promise<TikTokResult<TikTokTokenData>> {
  if (!opts.appKey || !opts.appSecret || !opts.authCode) {
    return { ok: false, error: 'Thiếu app_key/app_secret/auth_code để đổi token TikTok.' };
  }
  const q = new URLSearchParams({
    app_key: opts.appKey,
    app_secret: opts.appSecret,
    auth_code: opts.authCode,
    grant_type: 'authorized_code',
  });
  try {
    const body = await fetchJson(`${TIKTOK_AUTH_HOST}/api/v2/token/get?${q.toString()}`, { method: 'GET' });
    return parseTokenResponse(body);
  } catch (err: any) {
    return { ok: false, error: `Không đổi được code TikTok: ${err?.message ?? String(err)}` };
  }
}

/** Refresh access token (trả cả refresh token mới — phải lưu lại cả hai). */
export async function refreshAccessToken(opts: {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}): Promise<TikTokResult<TikTokTokenData>> {
  if (!opts.appKey || !opts.appSecret || !opts.refreshToken) {
    return { ok: false, error: 'Thiếu app_key/app_secret/refresh_token để làm mới token TikTok.' };
  }
  const q = new URLSearchParams({
    app_key: opts.appKey,
    app_secret: opts.appSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });
  try {
    const body = await fetchJson(`${TIKTOK_AUTH_HOST}/api/v2/token/refresh?${q.toString()}`, { method: 'GET' });
    return parseTokenResponse(body);
  } catch (err: any) {
    return { ok: false, error: `Không làm mới được token TikTok: ${err?.message ?? String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Gọi Business API (đã ký)
// ---------------------------------------------------------------------------

export interface TikTokApiCall {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopCipher?: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  /** Query phụ thêm (không gồm app_key/timestamp/sign/shop_cipher). */
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  apiVersion?: string;
}

export async function tiktokApi<T = any>(call: TikTokApiCall): Promise<TikTokResult<T>> {
  if (!call.appKey || !call.appSecret || !call.accessToken) {
    return { ok: false, error: 'Thiếu app_key/app_secret/access_token để gọi TikTok Shop API.' };
  }
  const version = call.apiVersion ?? TIKTOK_API_VERSION;
  const path = call.path.replace('{version}', version);
  const bodyString = call.body ? JSON.stringify(call.body) : undefined;
  const query: Record<string, string> = { ...(call.query ?? {}), app_key: call.appKey };
  if (call.shopCipher) query.shop_cipher = call.shopCipher;
  const { sign, timestamp } = signTikTokRequest(call.appSecret, path, query, bodyString);
  query.timestamp = timestamp;
  query.sign = sign;
  const url = `${TIKTOK_API_HOST}${path}?${new URLSearchParams(query).toString()}`;
  try {
    const res = await fetchJson(
      url,
      {
        method: call.method,
        headers: {
          'x-tts-access-token': call.accessToken,
          'Content-Type': 'application/json',
        },
        ...(bodyString ? { body: bodyString } : {}),
      },
      30000,
    );
    if (res?.__httpError) {
      return { ok: false, error: `TikTok trả lỗi HTTP ${res.status}.`, code: res.status };
    }
    if (res?.code !== 0) {
      // 36009002 = rate limit; 105005 = thiếu scope; 106013 = thiếu shop_cipher.
      return { ok: false, error: tiktokErrorMessage(res, 'TikTok trả lỗi không rõ mã.'), code: res?.code };
    }
    return { ok: true, data: (res.data ?? res) as T };
  } catch (err: any) {
    return { ok: false, error: `Không gọi được TikTok Shop API: ${err?.message ?? String(err)}` };
  }
}

/** Lấy danh sách shop đã ủy quyền (kèm shop_cipher) — gọi ngay sau khi đổi code. */
export async function getAuthorizedShops(call: Omit<TikTokApiCall, 'method' | 'path' | 'shopCipher'>): Promise<
  TikTokResult<{ shops: Array<{ id: string; name?: string; cipher: string; code?: string; region?: string }> }>
> {
  return tiktokApi<{ shops: Array<{ id: string; name?: string; cipher: string; code?: string; region?: string }> }>({
    ...call,
    method: 'GET',
    path: '/authorization/{version}/shops',
  });
}

// ---------------------------------------------------------------------------
// Đơn hàng
// ---------------------------------------------------------------------------

export interface TikTokLineItem {
  id: string;
  product_id: string;
  product_name?: string;
  sku_id: string;
  sku_name?: string;
  seller_sku?: string;
  sku_image?: string;
  currency?: string;
  original_price?: string;
  sale_price?: string;
  seller_discount?: string;
  platform_discount?: string;
  display_status?: string;
  package_id?: string;
  package_status?: string;
  tracking_number?: string;
  shipping_provider_name?: string;
}

export interface TikTokOrder {
  id: string;
  status: string;
  create_time?: number;
  update_time?: number;
  paid_time?: number;
  buyer_email?: string;
  buyer_message?: string;
  shipping_type?: string;
  fulfillment_type?: string;
  payment_method_name?: string;
  is_cod?: boolean;
  payment?: {
    currency?: string;
    sub_total?: string;
    shipping_fee?: string;
    seller_discount?: string;
    platform_discount?: string;
    tax?: string;
    total_amount?: string;
    original_total_product_price?: string;
    original_shipping_fee?: string;
  };
  recipient_address?: {
    name?: string;
    phone_number?: string;
    full_address?: string;
    region_code?: string;
    postal_code?: string;
    district_info?: Array<{ address_level?: string; address_level_name?: string; address_name?: string }>;
  };
  packages?: Array<{ id: string }>;
  line_items?: TikTokLineItem[];
}

/** Tìm đơn (lọc theo update_time để đồng bộ tăng dần; page_size tối đa 100). */
export async function searchOrders(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  filters: Record<string, unknown>,
  pageSize = 50,
  pageToken?: string,
): Promise<TikTokResult<{ orders: TikTokOrder[]; total_count?: number; next_page_token?: string }>> {
  const query: Record<string, string> = { page_size: String(Math.min(100, Math.max(1, pageSize))) };
  if (pageToken) query.page_token = pageToken;
  return tiktokApi({
    ...call,
    method: 'POST',
    path: '/order/{version}/orders/search',
    query,
    body: filters,
  });
}

/** Chi tiết 1 đơn (kèm line_items đầy đủ). */
export async function getOrderDetail(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  orderId: string,
): Promise<TikTokResult<TikTokOrder>> {
  return tiktokApi<TikTokOrder>({
    ...call,
    method: 'GET',
    path: `/order/{version}/orders/${encodeURIComponent(orderId)}`,
  });
}

/** Lịch sử vận chuyển của 1 đơn (mã vận đơn + scan của hãng). */
export async function getOrderTracking(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  orderId: string,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'GET',
    path: `/order/{version}/orders/${encodeURIComponent(orderId)}/tracking`,
  });
}

// ---------------------------------------------------------------------------
// Sản phẩm / tồn kho
// ---------------------------------------------------------------------------

export interface TikTokSku {
  id: string;
  seller_sku?: string;
  price?: { currency?: string; sale_price?: string; tax_exclusive_price?: string };
  inventory?: Array<{ warehouse_id: string; quantity: number }>;
}

export interface TikTokProduct {
  id: string;
  title?: string;
  status?: string;
  create_time?: number;
  update_time?: number;
  skus?: TikTokSku[];
}

/** Tìm sản phẩm (lọc theo status khi cần). */
export async function searchProducts(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  filters: Record<string, unknown> = {},
  pageSize = 50,
  pageToken?: string,
): Promise<TikTokResult<{ products: TikTokProduct[]; total_count?: number; next_page_token?: string }>> {
  const query: Record<string, string> = { page_size: String(Math.min(100, Math.max(1, pageSize))) };
  if (pageToken) query.page_token = pageToken;
  return tiktokApi({
    ...call,
    method: 'POST',
    path: '/product/{version}/products/search',
    query,
    body: filters,
  });
}

/** Chi tiết 1 sản phẩm (kèm toàn bộ SKU + tồn kho từng kho). */
export async function getProduct(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  productId: string,
): Promise<TikTokResult<TikTokProduct>> {
  return tiktokApi<TikTokProduct>({
    ...call,
    method: 'GET',
    path: `/product/{version}/products/${encodeURIComponent(productId)}`,
  });
}

/** Tồn kho hàng loạt (theo danh sách sku_id). */
export async function searchInventory(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  skuIds: string[],
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: '/product/{version}/inventory/search',
    body: { sku_ids: skuIds },
  });
}

/** Đổi giá theo SKU (1 lần gọi cho 1 sản phẩm, nhiều SKU). */
export async function updateProductPrices(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  productId: string,
  skus: Array<{ id: string; price: { amount: string; currency: string } }>,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: `/product/{version}/products/${encodeURIComponent(productId)}/prices/update`,
    body: { skus },
  });
}

/** Đổi tồn kho theo SKU (số lượng TUYỆT ĐỐI, theo từng kho). */
export async function updateProductInventory(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  productId: string,
  skus: Array<{ id: string; inventory: Array<{ warehouse_id: string; quantity: number }> }>,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: `/product/{version}/products/${encodeURIComponent(productId)}/inventory/update`,
    body: { skus },
  });
}

// ---------------------------------------------------------------------------
// Hoàn / trả / hủy
// ---------------------------------------------------------------------------

export interface TikTokReturn {
  id?: string;
  return_id?: string;
  order_id: string;
  status?: string;
  return_type?: string;
  reason?: string;
  refund_amount?: { currency?: string; refund_total?: string; refund_subtotal?: string; refund_shipping_fee?: string; refund_tax?: string };
  line_items?: Array<{ sku_id?: string; product_id?: string; quantity?: number }>;
  create_time?: number;
  update_time?: number;
}

export async function searchReturns(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  filters: Record<string, unknown>,
  pageSize = 50,
  pageToken?: string,
): Promise<TikTokResult<{ returns: TikTokReturn[]; total_count?: number; next_page_token?: string }>> {
  const query: Record<string, string> = { page_size: String(Math.min(100, Math.max(1, pageSize))) };
  if (pageToken) query.page_token = pageToken;
  return tiktokApi({
    ...call,
    method: 'POST',
    path: '/return_refund/{version}/returns/search',
    query,
    body: filters,
  });
}

export async function searchCancellations(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  filters: Record<string, unknown>,
  pageSize = 50,
  pageToken?: string,
): Promise<TikTokResult<{ cancellations: TikTokReturn[]; total_count?: number; next_page_token?: string }>> {
  const query: Record<string, string> = { page_size: String(Math.min(100, Math.max(1, pageSize))) };
  if (pageToken) query.page_token = pageToken;
  return tiktokApi({
    ...call,
    method: 'POST',
    path: '/return_refund/{version}/cancellations/search',
    query,
    body: filters,
  });
}

export async function approveReturn(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  returnId: string,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: '/return_refund/{version}/returns/approve',
    body: { return_id: returnId },
  });
}

export async function rejectReturn(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  returnId: string,
  reason?: string,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: '/return_refund/{version}/returns/reject',
    body: { return_id: returnId, ...(reason ? { reject_reason: reason } : {}) },
  });
}

/** Tính trước số tiền hoàn thực tế (sau phần sàn đóng góp) trước khi duyệt. */
export async function calculateRefund(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  returnId: string,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: '/return_refund/{version}/refunds/calculate',
    body: { return_id: returnId },
  });
}

// ---------------------------------------------------------------------------
// Tài chính / đối soát
// ---------------------------------------------------------------------------

export async function listStatements(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  createTimeGe?: number,
  createTimeLt?: number,
  pageSize = 20,
  pageToken?: string,
): Promise<TikTokResult<any>> {
  const query: Record<string, string> = { page_size: String(pageSize) };
  if (createTimeGe) query.create_time_ge = String(createTimeGe);
  if (createTimeLt) query.create_time_lt = String(createTimeLt);
  if (pageToken) query.page_token = pageToken;
  return tiktokApi<any>({ ...call, method: 'GET', path: '/finance/{version}/statements', query });
}

export async function listStatementTransactions(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  statementId: string,
  pageSize = 50,
  pageToken?: string,
): Promise<TikTokResult<any>> {
  const query: Record<string, string> = { page_size: String(pageSize) };
  if (pageToken) query.page_token = pageToken;
  return tiktokApi<any>({
    ...call,
    method: 'GET',
    path: `/finance/{version}/statements/${encodeURIComponent(statementId)}/statement_transactions`,
    query,
  });
}

/** Payments — LƯU Ý: API này hiện KHÔNG dùng được ở thị trường Đông Nam Á (Partner Center). */
export async function listPayments(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  createTimeGe?: number,
  createTimeLt?: number,
  pageSize = 20,
  pageToken?: string,
): Promise<TikTokResult<any>> {
  const query: Record<string, string> = { page_size: String(pageSize) };
  if (createTimeGe) query.create_time_ge = String(createTimeGe);
  if (createTimeLt) query.create_time_lt = String(createTimeLt);
  if (pageToken) query.page_token = pageToken;
  return tiktokApi<any>({ ...call, method: 'GET', path: '/finance/{version}/payments', query });
}

export async function listWithdrawals(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  createTimeGe?: number,
  createTimeLt?: number,
  pageSize = 20,
  pageToken?: string,
): Promise<TikTokResult<any>> {
  const query: Record<string, string> = { page_size: String(pageSize) };
  if (createTimeGe) query.create_time_ge = String(createTimeGe);
  if (createTimeLt) query.create_time_lt = String(createTimeLt);
  if (pageToken) query.page_token = pageToken;
  return tiktokApi<any>({ ...call, method: 'GET', path: '/finance/{version}/withdrawals', query });
}

// ---------------------------------------------------------------------------
// Webhook: đăng ký + verify chữ ký
// ---------------------------------------------------------------------------

/** Đăng ký/đổi URL webhook cho 1 loại event (idempotent theo event_type). */
export async function registerWebhook(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  eventType: string,
  address: string,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'PUT',
    path: '/event/{version}/webhooks',
    body: { event_type: eventType, address },
  });
}

/**
 * Verify chữ ký webhook TikTok.
 * - Chính: header Authorization = HMAC-SHA256(app_secret, app_key + raw_body), hex.
 * - Dự phòng: header x-tts-signature = HMAC-SHA256(app_secret, app_key + timestamp + raw_body),
 *   timestamp lấy ở header x-tts-timestamp (định dạng mới hơn của TikTok).
 * So sánh bằng timingSafeEqual, KHÔNG so chuỗi thường. rawBody phải là body thô
 * chưa qua JSON.parse (xem server.ts: route /webhook/tiktok dùng express.raw).
 */
export function verifyTikTokWebhookSignature(
  appKey: string,
  appSecret: string,
  rawBody: string | Buffer,
  authorizationHeader: string | undefined | null,
  xTtsSignature?: string | undefined | null,
  xTtsTimestamp?: string | undefined | null,
): boolean {
  if (!appKey || !appSecret) return false;
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const check = (expectedHex: string, provided: string | undefined | null): boolean => {
    if (!provided) return false;
    const a = Buffer.from(expectedHex, 'utf8');
    const b = Buffer.from(String(provided).trim(), 'utf8');
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  };
  const primary = crypto.createHmac('sha256', appSecret).update(Buffer.concat([Buffer.from(appKey, 'utf8'), bodyBuf])).digest('hex');
  if (check(primary, authorizationHeader)) return true;
  if (xTtsSignature && xTtsTimestamp) {
    const alt = crypto
      .createHmac('sha256', appSecret)
      .update(Buffer.concat([Buffer.from(appKey, 'utf8'), Buffer.from(String(xTtsTimestamp), 'utf8'), bodyBuf]))
      .digest('hex');
    if (check(alt, xTtsSignature)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Chat khách (Customer Service API) — CHỈ khi scope đã được TikTok cấp
// ---------------------------------------------------------------------------

/** Gửi tin text cho khách trong 1 hội thoại TikTok (cần scope customer service). */
export async function sendCustomerServiceMessage(
  call: Omit<TikTokApiCall, 'method' | 'path'>,
  conversationId: string,
  text: string,
): Promise<TikTokResult<any>> {
  return tiktokApi<any>({
    ...call,
    method: 'POST',
    path: `/customer_service/{version}/conversations/${encodeURIComponent(conversationId)}/messages`,
    body: { type: 'TEXT', content: { text } },
  });
}

// ---------------------------------------------------------------------------
// Map dữ liệu TikTok -> AChatGo (hàm thuần, có test ở scripts/test-tiktok.ts)
// ---------------------------------------------------------------------------

/** Map trạng thái đơn TikTok sang 8 bước của app. */
export function mapTikTokOrderStatus(status: string): OrderStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'UNPAID':
    case 'ON_HOLD':
      return 'cho_duyet';
    case 'AWAITING_SHIPMENT':
      return 'cho_dong_goi';
    case 'AWAITING_COLLECTION':
      return 'cho_lay_hang';
    case 'PARTIALLY_SHIPPING':
    case 'IN_TRANSIT':
      return 'dang_giao_hang';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'da_giao_hang';
    case 'CANCELLED':
      return 'da_huy';
    default:
      return 'cho_duyet';
  }
}

/** Map trạng thái hoàn/trả TikTok sang bước phiếu trả của app (1-5, chỉ dùng để gợi ý). */
export function mapTikTokReturnStatus(status: string): number {
  const s = (status ?? '').toUpperCase();
  if (s.includes('COMPLETE') || s.includes('SUCCESS') || s.includes('REFUNDED')) return 5;
  if (s.includes('APPROVE')) return 2;
  if (s.includes('REJECT')) return 4;
  if (s.includes('CANCEL')) return 4;
  return 1;
}

/** Tiền TikTok là chuỗi thập phân ("149000.00") -> số nguyên đồng. */
export function tiktokMoneyToVnd(amount: string | number | undefined | null): number {
  if (amount === undefined || amount === null || amount === '') return 0;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** SĐT/địa chỉ TikTok có thể bị che ("J*** D***", "(+1)123***4567"). */
export function tiktokIsMasked(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.includes('*');
}

/** SĐT VN thật (bắt đầu 0, 10 số) — chỉ số này mới được upsert khách hàng. */
export function tiktokIsRealVnPhone(value: string | undefined | null): boolean {
  return typeof value === 'string' && /^0\d{9}$/.test(value.replace(/[\s.+-]/g, ''));
}

export interface GroupedTikTokItem {
  skuId: string;
  productId: string;
  productName: string;
  sellerSku: string;
  skuName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  packageId?: string;
  trackingNumber?: string;
  shippingProviderName?: string;
}

/**
 * Gộp line_items: MỘT entry = MỘT chiếc → gộp theo sku_id để ra số lượng.
 * Không giả định độ dài mảng = số SP khác nhau.
 */
export function groupTikTokLineItems(lineItems: TikTokLineItem[] | undefined | null): GroupedTikTokItem[] {
  const out = new Map<string, GroupedTikTokItem>();
  for (const li of lineItems ?? []) {
    const key = li.sku_id || li.id || li.product_id;
    const prev = out.get(key);
    const unitPrice = tiktokMoneyToVnd(li.sale_price ?? li.original_price);
    if (prev) {
      prev.quantity += 1;
    } else {
      out.set(key, {
        skuId: li.sku_id,
        productId: li.product_id,
        productName: li.product_name ?? '',
        sellerSku: li.seller_sku ?? '',
        skuName: li.sku_name ?? '',
        quantity: 1,
        unitPrice,
        currency: li.currency ?? '',
        packageId: li.package_id,
        trackingNumber: li.tracking_number,
        shippingProviderName: li.shipping_provider_name,
      });
    }
  }
  return [...out.values()];
}

/** Tách "Đen, 37" (sku_name TikTok) thành {color, size}. */
export function parseTikTokSkuName(skuName: string | undefined | null): { color: string; size: string } {
  const parts = String(skuName ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return { color: parts[0] ?? '', size: parts[1] ?? '' };
}

export interface TikTokOrderInput {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: OrderItem[];
  goodsTotal: number;
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
  remainingCod: number;
  currency: string;
  /** true = SĐT/địa chỉ bị TikTok che — nhân viên không gọi/giao trực tiếp được. */
  masked: boolean;
  /** SKU TikTok chưa map với catalogue (cần map tay ở Kênh bán hàng). */
  unmappedSkus: string[];
  /** Ghi chú nguồn sàn (mã đơn TikTok, phí, phương thức thanh toán...). */
  sourceNote: string;
}

/**
 * Map 1 đơn TikTok thành dữ liệu tạo đơn AChatGo. KHÔNG dùng computeOrderTotals
 * của shop (đơn sàn lấy tổng tiền sàn làm chuẩn; ship theo sàn, không theo quy
 * tắc ship Facebook). COD: còn phải thu = tổng đơn; đã thanh toán online:
 * còn phải thu = 0 (tiền về qua đối soát TikTok).
 */
export function mapTikTokOrderToOrderInput(
  order: TikTokOrder,
  skuMaps: TikTokSkuMap[],
  internalVariants: Array<{ sku: string; color: string; size: string; productId: string }>,
): TikTokOrderInput {
  const payment = order.payment ?? {};
  const currency = payment.currency ?? 'VND';
  const goodsTotal = tiktokMoneyToVnd(payment.sub_total ?? payment.original_total_product_price);
  const shippingFee = tiktokMoneyToVnd(payment.shipping_fee ?? payment.original_shipping_fee);
  const discountAmount =
    tiktokMoneyToVnd(payment.seller_discount) + tiktokMoneyToVnd(payment.platform_discount);
  const totalAmount = tiktokMoneyToVnd(payment.total_amount);
  const remainingCod = order.is_cod ? totalAmount : 0;

  const addr = order.recipient_address ?? {};
  const customerName = String(addr.name ?? '');
  const customerPhone = String(addr.phone_number ?? '');
  const customerAddress = String(addr.full_address ?? '');
  const masked = tiktokIsMasked(customerName) || tiktokIsMasked(customerPhone);

  const grouped = groupTikTokLineItems(order.line_items);
  const items: OrderItem[] = [];
  const unmappedSkus: string[] = [];
  for (const g of grouped) {
    const map = skuMaps.find((m) => m.skuId === g.skuId || (g.sellerSku && m.internalSku === g.sellerSku));
    const variant = map
      ? internalVariants.find((v) => v.sku === map.internalSku)
      : g.sellerSku
        ? internalVariants.find((v) => v.sku === g.sellerSku)
        : undefined;
    const parsed = parseTikTokSkuName(g.skuName);
    if (!map && !variant) unmappedSkus.push(g.sellerSku || g.skuId);
    items.push({
      productId: variant?.productId ?? map?.productId ?? '',
      sku: variant?.sku ?? g.sellerSku ?? g.skuId,
      color: variant?.color ?? parsed.color,
      size: variant?.size ?? parsed.size,
      quantity: g.quantity,
      price: g.unitPrice,
    });
  }

  const feeParts: string[] = [];
  if (payment.tax) feeParts.push(`thuế ${payment.tax} ${currency}`);
  const sourceNote =
    `Đơn TikTok Shop #${order.id} (${order.status})` +
    ` — ${order.payment_method_name ?? ''}${order.is_cod ? ' (COD)' : ' (đã thanh toán online)'}` +
    (feeParts.length ? ` — ${feeParts.join(', ')}` : '') +
    (masked ? ' — SĐT/địa chỉ bị TikTok che (chưa xin quyền dữ liệu nhạy cảm).' : '') +
    (unmappedSkus.length ? ` — SKU chưa map: ${unmappedSkus.join(', ')}.` : '');

  return {
    customerName,
    customerPhone,
    customerAddress,
    items,
    goodsTotal,
    shippingFee,
    discountAmount,
    totalAmount,
    remainingCod,
    currency,
    masked,
    unmappedSkus,
    sourceNote,
  };
}

// ---------------------------------------------------------------------------
// Ghi đơn TikTok vào state (dùng chung cho sync + webhook — tránh trùng mã)
// ---------------------------------------------------------------------------

/** Tìm đơn AChatGo theo mã đơn TikTok (dedupe theo mã đơn sàn). */
export function findOrderByTikTokId(state: State, shopKey: string, platformOrderId: string): Order | undefined {
  return state.orders.find(
    (o) => o.shopKey === shopKey && (o as unknown as Record<string, unknown>).tiktokOrderId === platformOrderId,
  );
}

export interface UpsertTikTokOrderResult {
  order: Order;
  created: boolean;
  statusChanged: boolean;
}

/**
 * Tạo mới hoặc cập nhật đơn AChatGo từ 1 đơn TikTok (dedupe theo mã đơn sàn).
 * - Đơn mới: mã ACH77000xxx (nextOrderCode, gọi tuần tự), trạng thái map từ sàn,
 *   carrier 'TikTok' (đơn sàn đi logistics sàn, không đẩy GHN/GHTK),
 *   capiStatus 'chua_ket_noi' (đơn sàn KHÔNG báo Purchase về Facebook).
 * - Đơn đã có: chỉ cập nhật trạng thái/tổng tiền khi thay đổi + ghi history.
 * - Khách hàng: chỉ upsert khi SĐT VN thật (không che).
 */
export function upsertTikTokOrder(
  state: State,
  shopKey: string,
  platformOrder: TikTokOrder,
  skuMaps: TikTokSkuMap[],
  internalVariants: Array<{ sku: string; color: string; size: string; productId: string }>,
  by?: string,
): UpsertTikTokOrderResult {
  const input = mapTikTokOrderToOrderInput(platformOrder, skuMaps, internalVariants);
  const now = tiktokNowIso();
  const existing = findOrderByTikTokId(state, shopKey, platformOrder.id);
  const mappedStatus = mapTikTokOrderStatus(platformOrder.status);
  const waybill = platformOrder.line_items?.find((li) => li.tracking_number)?.tracking_number ?? '';
  const carrierName = platformOrder.line_items?.find((li) => li.shipping_provider_name)?.shipping_provider_name ?? '';

  if (existing) {
    const ext = existing as unknown as Record<string, unknown>;
    const statusChanged = existing.orderStatus !== mappedStatus;
    ext.tiktokStatus = platformOrder.status;
    if (statusChanged) {
      const from = existing.orderStatus;
      existing.orderStatus = mappedStatus;
      const history = (ext.history as Array<Record<string, unknown>> | undefined) ?? [];
      history.push({
        time: now,
        action: 'changeStatus',
        note: `TikTok đổi trạng thái ${from} -> ${mappedStatus} (đơn sàn ${platformOrder.status})`,
        by,
      });
      ext.history = history;
    }
    existing.goodsTotal = input.goodsTotal;
    existing.shippingFee = input.shippingFee;
    existing.discountAmount = input.discountAmount;
    existing.totalAmount = input.totalAmount;
    existing.remainingCod = input.remainingCod;
    if (waybill) existing.waybillCode = waybill;
    if (carrierName) existing.carrier = carrierName;
    existing.updatedAt = now;
    return { order: existing, created: false, statusChanged };
  }

  const code = nextOrderCode(state);
  const order = {
    id: tiktokUid('ord'),
    code,
    shopKey,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerAddress: input.customerAddress,
    items: input.items,
    goodsTotal: input.goodsTotal,
    shippingFee: input.shippingFee,
    discountAmount: input.discountAmount,
    totalAmount: input.totalAmount,
    remainingCod: input.remainingCod,
    orderStatus: mappedStatus,
    carrier: carrierName || 'TikTok',
    waybillCode: waybill,
    note: input.sourceNote,
    source: 'tiktok',
    capiStatus: 'chua_ket_noi',
    capiLog: 'Đơn TikTok Shop — không báo Purchase về Facebook (đơn sàn, tiền về qua đối soát TikTok).',
    createdAt: now,
    updatedAt: now,
    tiktokOrderId: platformOrder.id,
    tiktokStatus: platformOrder.status,
    tiktokCurrency: input.currency,
    tiktokMasked: input.masked,
    tiktokShopCipher: '',
    history: [{ time: now, action: 'create', note: `Tạo đơn từ TikTok Shop #${platformOrder.id}`, by }],
  } as unknown as Order;
  state.orders.push(order);

  // Upsert khách hàng chỉ khi SĐT thật (không che).
  if (tiktokIsRealVnPhone(input.customerPhone)) {
    const phone = input.customerPhone.replace(/[\s.+-]/g, '');
    const existingCustomer = state.customers.find((c) => c.shopKey === shopKey && c.phone === phone);
    if (existingCustomer) {
      existingCustomer.totalSpent += input.totalAmount;
      if (input.customerAddress) existingCustomer.address = input.customerAddress;
    } else {
      state.customers.push({
        id: tiktokUid('cus'),
        shopKey,
        name: input.customerName || 'Khách TikTok',
        phone,
        address: input.customerAddress,
        totalSpent: input.totalAmount,
        loyaltyPoints: 0,
        loyaltyTier: 'thuong',
        createdAt: now,
      });
    }
  }
  return { order, created: true, statusChanged: false };
}

/** Khóa dedupe webhook: hash SHA-256 của raw body (TikTok 202309 không gửi tts_notification_id). */
export function tiktokWebhookDedupeKey(rawBody: string | Buffer): string {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}
