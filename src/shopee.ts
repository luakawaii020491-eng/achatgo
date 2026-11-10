/**
 * Shopee Open Platform API v2 — client + OAuth + sync cho AChatGo.
 *
 * Mô hình: Third-Party Partner (ISV) — 1 app Shopee DUY NHẤT cho cả nền
 * tảng AChatGo (mô hình Achat), Super Admin nhập partner_id/partner_key
 * 1 lần; các shop chỉ ủy quyền tài khoản seller của mình qua OAuth.
 *
 * KHÔNG có chat Shopee: Shopee đóng Chat API với app bên thứ 3 mới từ
 * 18/11/2024 — khách Shopee nhắn tin thì trả lời tay trong Seller Center.
 * SĐT/địa chỉ khách MẶC ĐỊNH BỊ CHE (masked) — muốn lấy thật phải xin
 * quyền sensitive-data riêng. Đơn Shopee đi logistics của Shopee — KHÔNG
 * đẩy sang GHN/GHTK/Best.
 *
 * Nguồn tham khảo (tra cứu 10-11-2026 — KHÔNG dùng dữ liệu thật):
 * - Shopee Open Platform (open.shopee.com): API v2, "Getting Started",
 *   "Quick Start", "v2.public", "v2.auth", "v2.order", "v2.product",
 *   "v2.logistics", "v2.payment", "v2.returns", "v2.push".
 * - Tài liệu mirror: fahmiwol/shopee-open-api (SKILL.md), cdn.jsdelivr.net
 *   /gh/netalith/shopee (README.md), github.com/laravelvn/shopee-sdk,
 *   ottermind/skills/shopee, congminh1254/shopee-sdk,
 *   intelligent.page/docs/shopee, shopee-sdk (PHP, laraditz).
 * - Host production: https://partner.shopeemobile.com
 *   Host sandbox: https://partner.test-stable.shopeemobile.com
 *
 * Ký request (HMAC-SHA256, hex, key = partner_key, timestamp = Unix giây,
 * hiệu lực ~5 phút):
 * - Shop-level (mọi API có access_token + shop_id):
 *   base = partner_id + api_path + timestamp + access_token + shop_id
 * - Public (auth link, token/get, access_token/get):
 *   base = partner_id + api_path + timestamp
 * Query: partner_id, timestamp, sign (+ access_token, shop_id với
 * shop-level). Response envelope: {error, message, response, request_id}
 * — error = chuỗi rỗng khi thành công.
 *
 * OAuth:
 * - GET /api/v2/shop/auth_partner?partner_id&timestamp&sign&redirect
 *   (sign public) → seller đăng nhập Shopee, chọn thời hạn ủy quyền
 *   7/30/90/180/365 ngày → callback trả code (10 phút, dùng 1 lần)
 *   + shop_id (+ main_account_id).
 * - POST /api/v2/auth/token/get {partner_id, code, shop_id, sign, timestamp}
 *   → access_token (expire_in 14400s = 4h — tính expiresAt = now + expire_in,
 *   KHÔNG phải timestamp tuyệt đối) + refresh_token (30 ngày, đổi mới mỗi
 *   lần refresh).
 * - POST /api/v2/auth/access_token/get {partner_id, refresh_token, shop_id,
 *   sign, timestamp} → access_token + refresh_token mới (xoay vòng).
 * - Ủy quyền tối đa 1 năm; Shopee gửi push code 12 bảy ngày trước khi
 *   hết hạn. partner_key hết hạn sau 180 ngày → cần reset trong console.
 *
 * LƯU Ý auth_partner: Shopee KHÔNG hỗ trợ tham số state — callback chỉ
 * trả code + shop_id, nên server không phân biệt được shop nào bấm kết
 * nối nếu 2 shop bấm cùng lúc. Cách xử lý: mỗi lần bấm "Kết nối Shopee"
 * tạo 1 pending authorization (1 pending duy nhất, hết hạn 10 phút);
 * nếu đang có pending còn hạn thì từ chối bấm tiếp và báo chờ. Callback
 * dùng pending mới nhất để gán token, rồi hiển thị tên shop Shopee để
 * người dùng kiểm chứng. (TikTok có state nên không gặp vấn đề này.)
 *
 * Đơn hàng (get_order_list: tối đa 15 ngày/lần, phân trang bằng cursor):
 * - Trạng thái Shopee: UNPAID, READY_TO_SHIP, PROCESSED, SHIPPED,
 *   COMPLETED, IN_CANCEL, CANCELLED, INVOICE_PENDING (+ PENDING).
 * - Map sang workflow 8 bước của app (xem mapShopeeOrderStatus).
 * - Tiền: Shopee trả số tiền dạng số, đơn vị VND (không phải cents).
 * - Đối soát: get_escrow_detail (Shopee escrow, KHÔNG phải COD).
 *
 * Push (webhook): subscribe trong console (Push Mechanism) hoặc qua API.
 * Code: 1 shop authorized, 2 shop deauthorized, 3 order status update,
 * 4 tracking number update, 10 buyer message, 12 authorization expiry
 * (7 ngày trước). Push chỉ là thông báo thay đổi — phải gọi API lấy
 * chi tiết. Verify: header Authorization = hex HMAC-SHA256(partner_key,
 * callbackUrl + "|" + raw body) — so khớp timingSafeEqual. Fallback
 * X-Shopee-Signature = HMAC(raw body). Khôi phục: get_lost_push_message.
 */

import crypto from 'node:crypto';
import type { Order, OrderItem, OrderStatus, ShopeePlatformConfig } from './types.js';
import { nextOrderCode } from './auth.js';

export type { ShopeePlatformConfig };

// ---------------------------------------------------------------------------
// Hằng số
// ---------------------------------------------------------------------------

export const SHOPEE_API_HOST = 'https://partner.shopeemobile.com';
export const SHOPEE_SANDBOX_HOST = 'https://partner.test-stable.shopeemobile.com';
export const SHOPEE_AUTH_PATH = '/api/v2/shop/auth_partner';
export const SHOPEE_TOKEN_PATH = '/api/v2/auth/token/get';
export const SHOPEE_REFRESH_PATH = '/api/v2/auth/access_token/get';
export const SHOPEE_GET_SHOP_INFO_PATH = '/api/v2/shop/get_shop_info';
export const SHOPEE_GET_ITEM_LIST_PATH = '/api/v2/product/get_item_list';
export const SHOPEE_GET_ITEM_BASE_INFO_PATH = '/api/v2/product/get_item_base_info';
export const SHOPEE_GET_ITEM_EXTRA_INFO_PATH = '/api/v2/product/get_item_extra_info';
export const SHOPEE_GET_MODEL_LIST_PATH = '/api/v2/product/get_model_list';
export const SHOPEE_UPDATE_PRICE_PATH = '/api/v2/product/update_price';
export const SHOPEE_UPDATE_STOCK_PATH = '/api/v2/product/update_stock';
export const SHOPEE_GET_ORDER_LIST_PATH = '/api/v2/order/get_order_list';
export const SHOPEE_GET_ORDER_DETAIL_PATH = '/api/v2/order/get_order_detail';
export const SHOPEE_GET_TRACKING_NUMBER_PATH = '/api/v2/logistics/get_tracking_number';
export const SHOPEE_GET_TRACKING_INFO_PATH = '/api/v2/logistics/get_tracking_info';
export const SHOPEE_GET_ESCROW_DETAIL_PATH = '/api/v2/payment/get_escrow_detail';
export const SHOPEE_GET_PAYOUT_DETAIL_PATH = '/api/v2/payment/get_payout_detail';
export const SHOPEE_GET_RETURN_LIST_PATH = '/api/v2/returns/get_return_list';
export const SHOPEE_GET_LOST_PUSH_PATH = '/api/v2/push/get_lost_push_message';
export const SHOPEE_CONFIRM_LOST_PUSH_PATH = '/api/v2/push/confirm_consumed_lost_push_message';

/** Thời hạn ủy quyền seller được chọn khi authorize (ngày). */
export const SHOPEE_AUTH_DURATIONS = [7, 30, 90, 180, 365] as const;
/** access_token sống 4 giờ (expire_in = 14400 giây). */
export const SHOPEE_ACCESS_TOKEN_TTL_S = 14400;
/** refresh_token sống 30 ngày, xoay vòng mỗi lần refresh. */
export const SHOPEE_REFRESH_TOKEN_TTL_DAYS = 30;
/** partner_key hết hạn sau 180 ngày — nhắc Super Admin reset. */
export const SHOPEE_PARTNER_KEY_TTL_DAYS = 180;
/** Ủy quyền tối đa 1 năm. */
export const SHOPEE_AUTH_MAX_DAYS = 365;

export type ShopeeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ShopeeCall {
  partnerId: string;
  partnerKey: string;
  accessToken: string;
  shopId: string;
  /** Host API: production hoặc sandbox (mặc định production). */
  host?: string;
}

export interface ShopeeShopConfig {
  status: 'connected' | 'disconnected' | 'expired' | 'revoked';
  shopId?: string;
  shopName?: string;
  accessToken?: string;
  refreshToken?: string;
  /** ISO — access_token hết hạn (4h sau khi cấp/refresh). */
  accessTokenExpiresAt?: string;
  /** ISO — refresh_token hết hạn (30 ngày). */
  refreshTokenExpiresAt?: string;
  /**
   * ISO — hạn ủy quyền TỐI ĐA (connectedAt + 365 ngày). Seller chọn
   * 7–365 ngày lúc ủy quyền nên hạn thật có thể sớm hơn; Shopee báo
   * trước 7 ngày qua push code 12 (xem authExpiryWarning).
   */
  authExpiresAt?: string;
  /** true = đã nhận push code 12 (sắp hết hạn ủy quyền). */
  authExpiryWarning?: boolean;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
}

export interface ShopeeSkuMap {
  id: string;
  shopKey: string;
  internalSku: string;
  /** Shopee item_id (số, dạng chuỗi). */
  itemId: string;
  /** Shopee model_id (số, dạng chuỗi) — '' khi item không có model. */
  modelId: string;
  productName?: string;
  modelName?: string;
  shopeeStock?: number;
  shopeePrice?: number;
  syncedAt?: string;
  createdAt?: string;
}

export interface ShopeeFinanceRecord {
  id: string;
  shopKey: string;
  kind: 'escrow' | 'payout';
  platformId: string;
  orderCode?: string;
  amount: number;
  currency?: string;
  detail?: string;
  createdAt?: string;
  raw?: unknown;
}

export interface ShopeeReturnRecord {
  id: string;
  shopKey: string;
  platformReturnId: string;
  orderCode?: string;
  kind: string;
  status: string;
  refundAmount?: number;
  reason?: string;
  createdAt?: string;
  raw?: unknown;
}

export interface ShopeeWebhookEvent {
  id: string;
  shopKey: string;
  eventType: string;
  code?: number;
  status: 'received' | 'processed' | 'failed' | 'duplicate';
  receivedAt?: string;
  note?: string;
  raw?: unknown;
}

export interface ShopeeItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  item_status?: string;
  price_info?: Array<{ currency?: string; current_price?: number; original_price?: number }>;
  stock_info_v2?: { summary_info?: { total_reserved_stock?: number; total_available_stock?: number } };
  image?: { image_url_list?: string[] };
  create_time?: number;
  update_time?: number;
  has_model?: boolean;
}

export interface ShopeeModel {
  model_id: number;
  model_sku?: string;
  model_name?: string;
  price_info?: Array<{ current_price?: number; original_price?: number }>;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
}

export interface ShopeeOrderItem {
  item_id: number;
  item_name: string;
  item_sku?: string;
  model_id?: number;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased: number;
  model_original_price: number;
  model_discounted_price: number;
}

export interface ShopeeOrderDetail {
  order_sn: string;
  order_status: string;
  create_time: number;
  update_time: number;
  pay_time?: number;
  buyer_user_id?: number;
  buyer_username?: string;
  recipient_address?: {
    name?: string;
    phone?: string;
    full_address?: string;
    town?: string;
    district?: string;
    city?: string;
    state?: string;
    zipcode?: string;
  };
  item_list?: ShopeeOrderItem[];
  package_list?: Array<{
    package_number?: string;
    logistics_channel_id?: number;
    shipping_carrier?: string;
    tracking_number?: string;
    logistics_status?: string;
  }>;
  total_amount: number;
  actual_shipping_fee?: number;
  estimated_shipping_fee?: number;
  payment_method?: string;
  message_to_seller?: string;
  checkout_shipping_carrier?: string;
}

export interface ShopeeEscrowDetail {
  order_sn: string;
  order_income?: {
    escrow_amount?: number;
    buyer_total_amount?: number;
    original_price?: number;
    seller_discount?: number;
    shopee_discount?: number;
    voucher_from_seller?: number;
    coins?: number;
    buyer_paid_shipping_fee?: number;
    actual_shipping_fee?: number;
    commission_fee?: number;
    service_fee?: number;
    seller_transaction_fee?: number;
  };
}

// ---------------------------------------------------------------------------
// Ký request
// ---------------------------------------------------------------------------

/**
 * Ký request Shopee (HMAC-SHA256, hex).
 * - Shop-level: base = partner_id + path + timestamp + access_token + shop_id
 * - Public: base = partner_id + path + timestamp
 */
export function signShopeeRequest(
  partnerKey: string,
  partnerId: string,
  path: string,
  timestamp: number,
  accessToken?: string,
  shopId?: string,
): string {
  const base = accessToken && shopId
    ? `${partnerId}${path}${timestamp}${accessToken}${shopId}`
    : `${partnerId}${path}${timestamp}`;
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex');
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface ShopeeAuthStateEntry {
  shopKey: string;
  createdAt: number;
}

/**
 * Pending authorization — Shopee auth_partner KHÔNG hỗ trợ state nên
 * callback không mang theo shopKey. Mỗi lần bấm "Kết nối Shopee" tạo
 * 1 pending duy nhất (10 phút); bấm tiếp khi pending còn hạn thì bị
 * từ chối để tránh gán nhầm shop. Callback dùng pending mới nhất.
 */
const shopeeAuthState = new Map<string, ShopeeAuthStateEntry>();
const SHOPEE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function createShopeeAuthState(shopKey: string): { ok: boolean; nonce?: string; error?: string } {
  const now = Date.now();
  for (const [nonce, entry] of shopeeAuthState) {
    if (now - entry.createdAt > SHOPEE_AUTH_STATE_TTL_MS) shopeeAuthState.delete(nonce);
  }
  if (shopeeAuthState.size > 0) {
    return { ok: false, error: 'Đang có 1 shop khác bấm "Kết nối Shopee" — chờ shop đó ủy quyền xong (tối đa 10 phút) rồi bấm lại, vì Shopee không trả về thông tin shop qua callback.' };
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  shopeeAuthState.set(nonce, { shopKey, createdAt: now });
  return { ok: true, nonce };
}

/** Callback Shopee: lấy pending mới nhất còn hạn (10 phút), dùng 1 lần. */
export function consumeShopeeAuthState(): ShopeeAuthStateEntry | null {
  const now = Date.now();
  let latest: { nonce: string; entry: ShopeeAuthStateEntry } | null = null;
  for (const [nonce, entry] of shopeeAuthState) {
    if (now - entry.createdAt > SHOPEE_AUTH_STATE_TTL_MS) { shopeeAuthState.delete(nonce); continue; }
    if (!latest || entry.createdAt > latest.entry.createdAt) latest = { nonce, entry };
  }
  if (!latest) return null;
  shopeeAuthState.delete(latest.nonce);
  return latest.entry;
}

export function buildShopeeAuthorizeUrl(opts: {
  partnerId: string;
  partnerKey: string;
  redirectUri: string;
  host?: string;
}): string {
  const host = opts.host ?? SHOPEE_API_HOST;
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest(opts.partnerKey, opts.partnerId, SHOPEE_AUTH_PATH, timestamp);
  const q = new URLSearchParams({
    partner_id: opts.partnerId,
    timestamp: String(timestamp),
    sign,
    redirect: opts.redirectUri,
  });
  return `${host}${SHOPEE_AUTH_PATH}?${q.toString()}`;
}

export interface ShopeeTokenResponse {
  accessToken: string;
  refreshToken: string;
  /** Giây cho tới khi access_token hết hạn (14400 = 4h). */
  expireIn: number;
  shopIdList?: string[];
}

/** POST /api/v2/auth/token/get — đổi code (10 phút, dùng 1 lần) lấy token. */
export async function exchangeShopeeAuthCode(opts: {
  partnerId: string;
  partnerKey: string;
  code: string;
  shopId: string;
  host?: string;
}): Promise<ShopeeResult<ShopeeTokenResponse>> {
  const host = opts.host ?? SHOPEE_API_HOST;
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest(opts.partnerKey, opts.partnerId, SHOPEE_TOKEN_PATH, timestamp);
  const res = await fetch(`${host}${SHOPEE_TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partner_id: Number(opts.partnerId),
      code: opts.code,
      shop_id: Number(opts.shopId),
      sign,
      timestamp,
    }),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { return { ok: false, error: `Shopee trả về không phải JSON (HTTP ${res.status}).` }; }
  if (!res.ok || json.error) {
    return { ok: false, error: shopeeErrorMessage(json, res.status) };
  }
  const r = json.response ?? {};
  if (!r.access_token || !r.refresh_token) return { ok: false, error: 'Shopee không trả access_token/refresh_token.' };
  return {
    ok: true,
    data: {
      accessToken: String(r.access_token),
      refreshToken: String(r.refresh_token),
      expireIn: Number(r.expire_in ?? SHOPEE_ACCESS_TOKEN_TTL_S),
      shopIdList: Array.isArray(r.shop_id_list) ? r.shop_id_list.map(String) : undefined,
    },
  };
}

/** POST /api/v2/auth/access_token/get — refresh (refresh_token xoay vòng). */
export async function refreshShopeeAccessToken(opts: {
  partnerId: string;
  partnerKey: string;
  refreshToken: string;
  shopId: string;
  host?: string;
}): Promise<ShopeeResult<ShopeeTokenResponse>> {
  const host = opts.host ?? SHOPEE_API_HOST;
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest(opts.partnerKey, opts.partnerId, SHOPEE_REFRESH_PATH, timestamp);
  const res = await fetch(`${host}${SHOPEE_REFRESH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      partner_id: Number(opts.partnerId),
      refresh_token: opts.refreshToken,
      shop_id: Number(opts.shopId),
      sign,
      timestamp,
    }),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { return { ok: false, error: `Shopee trả về không phải JSON (HTTP ${res.status}).` }; }
  if (!res.ok || json.error) {
    return { ok: false, error: shopeeErrorMessage(json, res.status) };
  }
  const r = json.response ?? {};
  if (!r.access_token || !r.refresh_token) return { ok: false, error: 'Shopee không trả access_token/refresh_token mới.' };
  return {
    ok: true,
    data: {
      accessToken: String(r.access_token),
      refreshToken: String(r.refresh_token),
      expireIn: Number(r.expire_in ?? SHOPEE_ACCESS_TOKEN_TTL_S),
      shopIdList: Array.isArray(r.shop_id_list) ? r.shop_id_list.map(String) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Lỗi + gọi API chung
// ---------------------------------------------------------------------------

function shopeeErrorMessage(json: any, httpStatus: number): string {
  const err = typeof json?.error === 'string' && json.error ? json.error : '';
  const msg = typeof json?.message === 'string' && json.message ? json.message : '';
  const detail = [err, msg].filter(Boolean).join(' — ');
  if (detail) return `Shopee: ${detail}`;
  return `Shopee trả lỗi HTTP ${httpStatus}.`;
}

export interface ShopeeApiOptions {
  /** Đặt false để gọi POST (mặc định GET). */
  get?: boolean;
  body?: Record<string, unknown>;
}

/**
 * Gọi API Shopee có ký (shop-level). Trả response.response khi error rỗng.
 * Lỗi mạng/HTTP/JSON đều trả {ok:false} — không throw để caller xử lý.
 */
export async function shopeeApi<T>(call: ShopeeCall, path: string, opts: ShopeeApiOptions = {}): Promise<ShopeeResult<T>> {
  const host = call.host ?? SHOPEE_API_HOST;
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest(call.partnerKey, call.partnerId, path, timestamp, call.accessToken, call.shopId);
  const q = new URLSearchParams({
    partner_id: call.partnerId,
    timestamp: String(timestamp),
    sign,
    access_token: call.accessToken,
    shop_id: call.shopId,
  });
  const url = `${host}${path}?${q.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.get === false ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.get === false ? JSON.stringify(opts.body ?? {}) : undefined,
    });
  } catch (e) {
    return { ok: false, error: `Không gọi được Shopee API: ${e instanceof Error ? e.message : String(e)}` };
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { return { ok: false, error: `Shopee trả về không phải JSON (HTTP ${res.status}).` }; }
  if (!res.ok || json.error) {
    return { ok: false, error: shopeeErrorMessage(json, res.status) };
  }
  return { ok: true, data: (json.response ?? {}) as T };
}

// ---------------------------------------------------------------------------
// Shop / sản phẩm / đơn / logistics / tài chính / hoàn trả
// ---------------------------------------------------------------------------

export async function getShopeeShopInfo(call: ShopeeCall): Promise<ShopeeResult<{ shop_id: number; shop_name: string; region?: string; status?: string; seller_name?: string }>> {
  return shopeeApi(call, SHOPEE_GET_SHOP_INFO_PATH);
}

export interface ShopeeItemListResponse {
  total_count?: number;
  item?: Array<{ item_id: number; item_status?: string; update_time?: number }>;
}

export async function getShopeeItemList(call: ShopeeCall, opts: {
  offset?: number;
  pageSize?: number;
  itemStatus?: string;
  updateTimeFrom?: number;
  updateTimeTo?: number;
}): Promise<ShopeeResult<ShopeeItemListResponse>> {
  const q = new URLSearchParams({
    offset: String(opts.offset ?? 0),
    page_size: String(opts.pageSize ?? 100),
  });
  if (opts.itemStatus) q.set('item_status', opts.itemStatus);
  if (opts.updateTimeFrom != null) q.set('update_time_from', String(opts.updateTimeFrom));
  if (opts.updateTimeTo != null) q.set('update_time_to', String(opts.updateTimeTo));
  return shopeeApi(call, `${SHOPEE_GET_ITEM_LIST_PATH}?${q.toString()}`);
}

export async function getShopeeItemBaseInfo(call: ShopeeCall, itemIds: number[]): Promise<ShopeeResult<{ item_list?: ShopeeItem[] }>> {
  const q = new URLSearchParams({ item_id_list: itemIds.join(',') });
  return shopeeApi(call, `${SHOPEE_GET_ITEM_BASE_INFO_PATH}?${q.toString()}`);
}

export async function getShopeeItemExtraInfo(call: ShopeeCall, itemIds: number[]): Promise<ShopeeResult<{ item_list?: Array<{ item_id: number; item_sku?: string }> }>> {
  const q = new URLSearchParams({ item_id_list: itemIds.join(',') });
  return shopeeApi(call, `${SHOPEE_GET_ITEM_EXTRA_INFO_PATH}?${q.toString()}`);
}

export async function getShopeeModelList(call: ShopeeCall, itemId: number): Promise<ShopeeResult<{ model?: ShopeeModel[] }>> {
  const q = new URLSearchParams({ item_id: String(itemId) });
  return shopeeApi(call, `${SHOPEE_GET_MODEL_LIST_PATH}?${q.toString()}`);
}

/** POST /api/v2/product/update_price {item_id, price_list: [{model_id, original_price}]} */
export async function updateShopeePrice(call: ShopeeCall, itemId: number, priceList: Array<{ model_id: number; original_price: number }>): Promise<ShopeeResult<Record<string, unknown>>> {
  return shopeeApi(call, SHOPEE_UPDATE_PRICE_PATH, {
    get: false,
    body: { item_id: itemId, price_list: priceList },
  });
}

/** POST /api/v2/product/update_stock {item_id, stock_list: [{model_id, normal_stock}]} */
export async function updateShopeeStock(call: ShopeeCall, itemId: number, stockList: Array<{ model_id: number; normal_stock: number }>): Promise<ShopeeResult<Record<string, unknown>>> {
  return shopeeApi(call, SHOPEE_UPDATE_STOCK_PATH, {
    get: false,
    body: { item_id: itemId, stock_list: stockList },
  });
}

export interface ShopeeOrderListResponse {
  order_list?: Array<{ order_sn: string; order_status?: string; update_time?: number }>;
  more?: boolean;
  next_cursor?: string;
}

/**
 * GET /api/v2/order/get_order_list — tối đa 15 ngày/lần, phân trang cursor.
 * timeRangeField: 'create_time' | 'update_time'.
 */
export async function getShopeeOrderList(call: ShopeeCall, opts: {
  timeRangeField?: 'create_time' | 'update_time';
  timeFrom: number;
  timeTo: number;
  pageSize?: number;
  cursor?: string;
  orderStatus?: string;
}): Promise<ShopeeResult<ShopeeOrderListResponse>> {
  const q = new URLSearchParams({
    time_range_field: opts.timeRangeField ?? 'update_time',
    time_from: String(opts.timeFrom),
    time_to: String(opts.timeTo),
    page_size: String(opts.pageSize ?? 100),
    cursor: opts.cursor ?? '',
  });
  if (opts.orderStatus) q.set('order_status', opts.orderStatus);
  return shopeeApi(call, `${SHOPEE_GET_ORDER_LIST_PATH}?${q.toString()}`);
}

/** GET /api/v2/order/get_order_detail?order_sn_list=a,b (tối đa 50). */
export async function getShopeeOrderDetail(call: ShopeeCall, orderSnList: string[], optionalFields?: string[]): Promise<ShopeeResult<{ order_list?: ShopeeOrderDetail[] }>> {
  const q = new URLSearchParams({ order_sn_list: orderSnList.join(',') });
  if (optionalFields?.length) q.set('response_optional_fields', optionalFields.join(','));
  return shopeeApi(call, `${SHOPEE_GET_ORDER_DETAIL_PATH}?${q.toString()}`);
}

export async function getShopeeTrackingNumber(call: ShopeeCall, orderSn: string, packageNumber?: string): Promise<ShopeeResult<{ tracking_number?: string }>> {
  const q = new URLSearchParams({ order_sn: orderSn });
  if (packageNumber) q.set('package_number', packageNumber);
  return shopeeApi(call, `${SHOPEE_GET_TRACKING_NUMBER_PATH}?${q.toString()}`);
}

export async function getShopeeTrackingInfo(call: ShopeeCall, orderSn: string, packageNumber?: string): Promise<ShopeeResult<{ tracking_info?: Array<{ update_time?: number; tracking_info?: string; status?: string }> }>> {
  const q = new URLSearchParams({ order_sn: orderSn });
  if (packageNumber) q.set('package_number', packageNumber);
  return shopeeApi(call, `${SHOPEE_GET_TRACKING_INFO_PATH}?${q.toString()}`);
}

/** GET /api/v2/payment/get_escrow_detail — đối soát tiền sàn (escrow, KHÔNG phải COD). */
export async function getShopeeEscrowDetail(call: ShopeeCall, orderSn: string): Promise<ShopeeResult<ShopeeEscrowDetail>> {
  const q = new URLSearchParams({ order_sn: orderSn });
  return shopeeApi(call, `${SHOPEE_GET_ESCROW_DETAIL_PATH}?${q.toString()}`);
}

export async function getShopeePayoutDetail(call: ShopeeCall, opts: { payoutTimeFrom?: number; payoutTimeTo?: number; pageNo?: number; pageSize?: number }): Promise<ShopeeResult<{ payout_list?: Array<Record<string, unknown>>; more?: boolean }>> {
  const q = new URLSearchParams({
    page_no: String(opts.pageNo ?? 1),
    page_size: String(opts.pageSize ?? 50),
  });
  if (opts.payoutTimeFrom != null) q.set('payout_time_from', String(opts.payoutTimeFrom));
  if (opts.payoutTimeTo != null) q.set('payout_time_to', String(opts.payoutTimeTo));
  return shopeeApi(call, `${SHOPEE_GET_PAYOUT_DETAIL_PATH}?${q.toString()}`);
}

/**
 * GET /api/v2/returns/get_return_list — hoàn/trả. Đường dẫn theo tài liệu
 * Shopee API v2 (mục Returns); khi đăng ký app cần tick scope Returns và
 * xác nhận lại trong console nếu Shopee đổi tên endpoint.
 */
export async function getShopeeReturnList(call: ShopeeCall, opts: { pageNo?: number; pageSize?: number; createTimeFrom?: number; createTimeTo?: number }): Promise<ShopeeResult<{ return?: Array<Record<string, unknown>>; more?: boolean }>> {
  const q = new URLSearchParams({
    page_no: String(opts.pageNo ?? 1),
    page_size: String(opts.pageSize ?? 50),
  });
  if (opts.createTimeFrom != null) q.set('create_time_from', String(opts.createTimeFrom));
  if (opts.createTimeTo != null) q.set('create_time_to', String(opts.createTimeTo));
  return shopeeApi(call, `${SHOPEE_GET_RETURN_LIST_PATH}?${q.toString()}`);
}

/** POST /api/v2/push/get_lost_push_message — khôi phục push bị mất. */
export async function getShopeeLostPushMessage(call: ShopeeCall): Promise<ShopeeResult<{ message_list?: Array<Record<string, unknown>> }>> {
  return shopeeApi(call, SHOPEE_GET_LOST_PUSH_PATH, { get: false, body: {} });
}

/** POST /api/v2/push/confirm_consumed_lost_push_message. */
export async function confirmShopeeLostPushMessage(call: ShopeeCall, messageIds: string[]): Promise<ShopeeResult<Record<string, unknown>>> {
  return shopeeApi(call, SHOPEE_CONFIRM_LOST_PUSH_PATH, {
    get: false,
    body: { message_id_list: messageIds },
  });
}

// ---------------------------------------------------------------------------
// Webhook (push) — verify + dedupe
// ---------------------------------------------------------------------------

/**
 * Verify chữ ký push Shopee.
 * - Chính: header Authorization = hex HMAC-SHA256(partner_key,
 *   callbackUrl + "|" + raw body) — callbackUrl là URL đầy đủ Shopee gọi.
 * - Fallback: header X-Shopee-Signature = hex HMAC-SHA256(partner_key,
 *   raw body).
 * Trả false khi thiếu header/không khớp.
 */
export function verifyShopeePushSignature(
  partnerKey: string,
  callbackUrl: string,
  rawBody: string,
  authorizationHeader?: string | null,
  xShopeeSignature?: string | null,
): boolean {
  const auth = (authorizationHeader ?? '').trim().toLowerCase();
  if (auth) {
    const expected = crypto.createHmac('sha256', partnerKey).update(`${callbackUrl}|${rawBody}`).digest('hex');
    if (safeEqualHex(expected, auth)) return true;
  }
  const xsig = (xShopeeSignature ?? '').trim().toLowerCase();
  if (xsig) {
    const expected = crypto.createHmac('sha256', partnerKey).update(rawBody).digest('hex');
    if (safeEqualHex(expected, xsig)) return true;
  }
  return false;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Key dedupe webhook = SHA-256 của raw body. */
export function shopeeWebhookDedupeKey(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

// ---------------------------------------------------------------------------
// Map trạng thái + tiền + che dữ liệu
// ---------------------------------------------------------------------------

/** Shopee → workflow 8 bước của app. */
export function mapShopeeOrderStatus(status: string): OrderStatus {
  switch ((status || '').toUpperCase()) {
    case 'UNPAID':
    case 'PENDING':
      return 'cho_duyet';
    case 'READY_TO_SHIP':
      return 'cho_dong_goi';
    case 'PROCESSED':
    case 'INVOICE_PENDING':
      return 'cho_lay_hang';
    case 'SHIPPED':
      return 'dang_giao_hang';
    case 'COMPLETED':
      return 'da_giao_hang';
    case 'CANCELLED':
      return 'da_huy';
    case 'IN_CANCEL':
      // Đang chờ hủy — giữ ở bước duyệt để nhân viên xử lý, đơn sẽ
      // chuyển sang CANCELLED rồi sync lại thành da_huy.
      return 'cho_duyet';
    default:
      return 'cho_duyet';
  }
}

/** Shopee return status → trạng thái phiếu trả nội bộ (1 chờ, 2 duyệt, 4 từ chối/hủy, 5 xong). */
export function mapShopeeReturnStatus(status: string): number {
  const s = (status ?? '').toUpperCase();
  if (s.includes('COMPLETE') || s.includes('SUCCESS') || s.includes('REFUND')) return 5;
  if (s.includes('APPROVE') || s.includes('ACCEPT')) return 2;
  if (s.includes('REJECT') || s.includes('CANCEL')) return 4;
  return 1;
}

/** Shopee trả tiền dạng số, đơn vị VND (không phải cents). */
export function shopeeMoneyToVnd(amount: unknown): number {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function shopeeIsMasked(value: unknown): boolean {
  return typeof value === 'string' && value.includes('*');
}

export function shopeeIsRealVnPhone(value: unknown): boolean {
  return typeof value === 'string' && /^0\d{9}$/.test(value.trim());
}

// ---------------------------------------------------------------------------
// Map đơn Shopee → đơn app (upsert, dedupe theo order_sn)
// ---------------------------------------------------------------------------

export interface GroupedShopeeItem {
  itemId: number;
  modelId?: number;
  modelSku: string;
  itemName: string;
  modelName: string;
  quantity: number;
  unitPrice: number;
}

export function groupShopeeLineItems(items: ShopeeOrderItem[]): GroupedShopeeItem[] {
  const byKey = new Map<string, GroupedShopeeItem>();
  for (const it of items ?? []) {
    const modelSku = String(it.model_sku ?? it.item_sku ?? '');
    const modelName = String(it.model_name ?? '');
    const key = `${it.item_id}|${it.model_id ?? ''}|${modelSku}|${modelName}`;
    const qty = Number(it.model_quantity_purchased ?? 1);
    const price = shopeeMoneyToVnd(it.model_discounted_price ?? it.model_original_price ?? 0);
    const prev = byKey.get(key);
    if (prev) prev.quantity += qty;
    else byKey.set(key, {
      itemId: it.item_id,
      modelId: it.model_id,
      modelSku,
      itemName: String(it.item_name ?? ''),
      modelName,
      quantity: qty,
      unitPrice: price,
    });
  }
  return [...byKey.values()];
}

/** Tách màu/size từ tên model Shopee ("Đen, 36" / "Đen / 36"). */
export function parseShopeeSkuName(modelName: string | undefined | null): { color: string; size: string } {
  const parts = String(modelName ?? '')
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { color: parts[0] ?? '', size: parts[1] ?? '' };
}

export interface ShopeeOrderInput {
  order: Omit<Order, 'code' | 'createdAt' | 'updatedAt'>;
  masked: boolean;
  /** SKU Shopee chưa map với catalogue (cần map tay ở Kênh bán hàng). */
  unmappedSkus: string[];
}

export function mapShopeeOrderToOrderInput(
  o: ShopeeOrderDetail,
  shopKey: string,
  skuMaps: ShopeeSkuMap[] = [],
  internalVariants: Array<{ sku: string; color: string; size: string; productId: string }> = [],
): ShopeeOrderInput {
  const items: OrderItem[] = [];
  const unmappedSkus: string[] = [];
  for (const g of groupShopeeLineItems(o.item_list ?? [])) {
    const map = skuMaps.find((m) =>
      (g.modelId != null && m.modelId === String(g.modelId) && m.itemId === String(g.itemId)) ||
      (g.modelSku && m.internalSku.toLowerCase() === g.modelSku.toLowerCase()));
    const variant = map
      ? internalVariants.find((v) => v.sku === map.internalSku)
      : g.modelSku
        ? internalVariants.find((v) => v.sku.toLowerCase() === g.modelSku.toLowerCase())
        : undefined;
    const parsed = parseShopeeSkuName(g.modelName);
    if (!map && !variant) unmappedSkus.push(g.modelSku || g.modelName || String(g.itemId));
    items.push({
      // productId nội bộ chỉ có khi map được variant (map Shopee không lưu productId).
      productId: variant?.productId ?? '',
      sku: variant?.sku ?? g.modelSku ?? g.modelName ?? String(g.itemId),
      color: variant?.color ?? parsed.color,
      size: variant?.size ?? parsed.size,
      quantity: g.quantity,
      price: g.unitPrice,
    });
  }
  const goodsTotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const shippingFee = shopeeMoneyToVnd(o.actual_shipping_fee ?? o.estimated_shipping_fee ?? 0);
  const totalAmount = shopeeMoneyToVnd(o.total_amount ?? goodsTotal + shippingFee);
  const addr = o.recipient_address ?? {};
  const fullAddress = [addr.full_address, addr.town, addr.district, addr.city, addr.state, addr.zipcode]
    .filter((x) => typeof x === 'string' && x.trim())
    .join(', ');
  const rawPhone = String(addr.phone ?? '');
  const rawName = String(addr.name ?? o.buyer_username ?? '');
  const masked = shopeeIsMasked(rawPhone) || shopeeIsMasked(rawName);
  const phone = shopeeIsRealVnPhone(rawPhone) ? rawPhone.trim() : '';
  const name = masked ? (o.buyer_username ?? '') : rawName;
  const isCod = /cod|cash on delivery/i.test(String(o.payment_method ?? ''));
  const pkg = (o.package_list ?? [])[0];
  const order: Omit<Order, 'code' | 'createdAt' | 'updatedAt'> = {
    shopKey,
    customerName: name,
    customerPhone: phone,
    customerAddress: fullAddress,
    items,
    goodsTotal,
    shippingFee,
    totalAmount,
    // Đơn Shopee thanh toán qua sàn (escrow) — COD chỉ khi payment_method là COD.
    remainingCod: isCod ? totalAmount : 0,
    discountAmount: 0,
    orderStatus: mapShopeeOrderStatus(o.order_status),
    // Đơn Shopee đi logistics của Shopee — KHÔNG đẩy sang GHN/GHTK/Best.
    carrier: pkg?.shipping_carrier ?? o.checkout_shipping_carrier ?? 'Shopee',
    waybillCode: pkg?.tracking_number ?? '',
    note: `Đơn Shopee ${o.order_sn}${o.message_to_seller ? ` — Khách nhắn: ${o.message_to_seller}` : ''}${masked ? ' — SĐT/địa chỉ Shopee đã che (cần quyền sensitive-data mới lấy thật).' : ''}${unmappedSkus.length ? ` — SKU chưa map: ${unmappedSkus.slice(0, 5).join(', ')}` : ''}`,
    capiStatus: 'chua_ket_noi',
    capiLog: '',
  };
  return { order, masked, unmappedSkus };
}

export function findOrderByShopeeSn(orders: Order[], orderSn: string): Order | undefined {
  return orders.find((o) => (o as Order & { shopeeOrderSn?: string }).shopeeOrderSn === orderSn);
}

/**
 * Upsert đơn Shopee vào state.orders (dedupe theo order_sn). Trả
 * 'created' | 'updated'. Khách chỉ được upsert khi có SĐT VN thật
 * (SĐT bị che thì không tạo khách ảo).
 */
export function upsertShopeeOrder(
  state: { orders: Order[]; customers: Array<{ id: string; shopKey: string; name: string; phone: string; address?: string; createdAt?: string }> },
  detail: ShopeeOrderDetail,
  shopKey: string,
  skuMaps: ShopeeSkuMap[] = [],
  internalVariants: Array<{ sku: string; color: string; size: string; productId: string }> = [],
): { action: 'created' | 'updated'; order: Order } {
  const { order, masked } = mapShopeeOrderToOrderInput(detail, shopKey, skuMaps, internalVariants);
  const existing = findOrderByShopeeSn(state.orders, detail.order_sn);
  const now = new Date().toISOString();
  if (existing) {
    const mappedStatus = mapShopeeOrderStatus(detail.order_status);
    const ext = existing as unknown as Record<string, unknown>;
    if (existing.orderStatus !== mappedStatus) {
      const from = existing.orderStatus;
      existing.orderStatus = mappedStatus;
      const history = (ext.history as Array<Record<string, unknown>> | undefined) ?? [];
      history.push({
        time: now,
        action: 'changeStatus',
        note: `Shopee đổi trạng thái ${from} -> ${mappedStatus} (đơn sàn ${detail.order_status})`,
        by: 'shopee-sync',
      });
      ext.history = history;
    }
    existing.goodsTotal = order.goodsTotal;
    existing.shippingFee = order.shippingFee;
    existing.totalAmount = order.totalAmount;
    existing.remainingCod = order.remainingCod;
    if (order.waybillCode) existing.waybillCode = order.waybillCode;
    if (order.carrier) existing.carrier = order.carrier;
    existing.updatedAt = now;
    ext.shopeeOrderSn = detail.order_sn;
    ext.shopeeStatus = detail.order_status;
    ext.shopeeCurrency = 'VND';
    ext.shopeeMasked = masked;
    return { action: 'updated', order: existing };
  }
  const created: Order & Record<string, unknown> = {
    ...order,
    code: nextOrderCode(state as unknown as Parameters<typeof nextOrderCode>[0]),
    createdAt: new Date((detail.create_time ?? 0) * 1000).toISOString(),
    updatedAt: now,
    source: 'shopee',
    shopeeOrderSn: detail.order_sn,
    shopeeStatus: detail.order_status,
    shopeeCurrency: 'VND',
    shopeeMasked: masked,
  };
  state.orders.push(created as Order);
  if (!masked && created.customerPhone) {
    const existsCustomer = state.customers.find((c) => c.shopKey === shopKey && c.phone === created.customerPhone);
    if (!existsCustomer) {
      state.customers.push({
        id: `c-shopee-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        shopKey,
        name: created.customerName,
        phone: created.customerPhone,
        address: created.customerAddress,
        createdAt: now,
      });
    }
  }
  return { action: 'created', order: created as Order };
}

// ---------------------------------------------------------------------------
// Platform config helpers
// ---------------------------------------------------------------------------

export function shopeePlatformConfigured(cfg: ShopeePlatformConfig | null | undefined): boolean {
  return Boolean(cfg?.partnerId && cfg?.partnerKey);
}

export function shopeePlatformPublic(cfg: ShopeePlatformConfig): Record<string, unknown> {
  const masked = cfg.partnerId ? `${cfg.partnerId.slice(0, 2)}****${cfg.partnerId.slice(-2)}` : '';
  const now = Date.now();
  const createdAt = cfg.partnerKeyCreatedAt ? Date.parse(cfg.partnerKeyCreatedAt) : NaN;
  const keyAgeDays = Number.isFinite(createdAt) ? Math.floor((now - createdAt) / 86400000) : null;
  return {
    partnerId: masked,
    hasPartnerKey: Boolean(cfg.partnerKey),
    redirectUri: cfg.redirectUri ?? '',
    webhookUrl: cfg.webhookUrl ?? '',
    apiHost: cfg.apiHost ?? SHOPEE_API_HOST,
    sandbox: Boolean(cfg.sandbox),
    partnerKeyAgeDays: keyAgeDays,
    /** partner_key hết hạn sau 180 ngày — nhắc Super Admin reset. */
    partnerKeyResetDue: keyAgeDays != null && keyAgeDays >= SHOPEE_PARTNER_KEY_TTL_DAYS - 14,
    configured: shopeePlatformConfigured(cfg),
  };
}

export function shopeeHostOf(cfg: ShopeePlatformConfig): string {
  if (cfg.sandbox) return SHOPEE_SANDBOX_HOST;
  return cfg.apiHost?.trim() || SHOPEE_API_HOST;
}

/** Ngày nhắc reset partner_key (tạo + 180 ngày). */
export function shopeePartnerKeyResetDate(cfg: ShopeePlatformConfig): string | null {
  if (!cfg.partnerKeyCreatedAt) return null;
  const d = new Date(Date.parse(cfg.partnerKeyCreatedAt) + SHOPEE_PARTNER_KEY_TTL_DAYS * 86400000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
