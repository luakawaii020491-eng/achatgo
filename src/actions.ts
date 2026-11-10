// src/actions.ts — Dispatcher 170 action của AChatGo standalone (v38).
//
// Import đúng module thật của dự án (đã có sẵn khi viết file này):
//   import type { State, ... } from './types.js';
//   import { hashPassword, loginAccount, maskSecret, nextOrderCode, toPublicAccount } from './auth.js';
//   import { computeOrderTotals } from './pricing.js';
//   import { scopeState } from './store.js';
//   import { ... } from './carriers.js'; './capi.js'; './meta.js';
//
// Lưu ý về State (types.ts): State dùng mảng (shops/orders/...), OrderStatus là
// chuỗi ('cho_duyet' | ... 8 bước), Shop mang pageLimit/staffLimit, Account
// dùng bcrypt. Những trường ngoài types.ts (token hãng vận chuyển, token
// CAPI, khóa AI, token page Meta, bình luận, phiên live, ...) được lưu kèm
// trong JSON qua các kiểu mở rộng ShopExt/OrderExt/StateExtFull dưới đây
// (cast tại chỗ, không sửa types.ts). Khi types.ts bổ sung các trường này
// thì bỏ cast tương ứng.
//
// Quy tắc bắt buộc (v37):
//   - Tài khoản shop chỉ thấy/sửa dữ liệu của đúng shop mình; shopKey luôn ép
//     từ ctx (không tin shopKey client gửi), trừ Super Admin. Server cũng
//     chặn kết nối page sang shop khác (quy tắc 2026-11-09 17:08/17:18).
//   - Shop mới trống hoàn toàn; Super Admin thấy tất cả, KHÔNG xóa dữ liệu cũ.
//   - updateorder KHÔNG được đổi orderStatus (chỉ qua changeorderstatus + history).
//   - deleteorder chỉ xóa khi có confirm:true (UI hỏi xác nhận trước).
//   - Redirect URI Meta: chỉ nhận địa chỉ web thật; từ chối URI rác ('null',
//     'null…', không phải http(s)) với hướng dẫn tiếng Việt (sửa 17:18).
//   - Không bịa kết quả: action nào chưa triển khai đầy đủ thì trả lỗi
//     'Chưa triển khai trong bản standalone: <tên>'.
//   - Không hard-code token/khóa/mật khẩu thật; secret chỉ trả về dạng đã che.
//
// ctx: server.ts truyền { account, shopKey, hostShopKey, version }; brief gốc
// mô tả { role, shopKey, accountId, isSuperAdmin }. Hỗ trợ CẢ HAI dạng.

import * as crypto from 'node:crypto';
import { hashPassword, loginAccount, maskSecret, nextOrderCode, toPublicAccount } from './auth.js';
import { computeOrderTotals } from './pricing.js';
import { scopeState } from './store.js';
import type {
  Account,
  AiRule,
  Campaign,
  CashEntry,
  Conversation,
  Customer,
  Order,
  OrderItem,
  OrderStatus,
  Product,
  Role,
  ShipFeeRule,
  Shop,
  State,
  TikTokPlatformConfig,
  Variant,
} from './types.js';
import { ORDER_STATUS_LABELS } from './types.js';
import {
  BEST_CONTRACT_FEE,
  GRAMS_PER_PAIR,
  bestWebhookReceive,
  cancelWaybill,
  pushOrderToCarrier,
  quoteCarrierFee,
  testCarrierConnection,
  trackWaybill,
} from './carriers.js';
import type { CarrierCode, CarrierConfig, CarrierResult, ShipOrderInput } from './carriers.js';
import { getCapiConfig, resendPurchaseEvent, sendPurchaseEvent, sendTestEvent, sha256hex } from './capi.js';
import type { CapiConfig as LibCapiConfig, CapiStatus as LibCapiStatus } from './capi.js';
import type { CapiStatus as OrderCapiStatus } from './types.js';
import {
  buildOAuthUrl,
  exchangeCodeForToken,
  graphGet,
  graphPost,
  listManagedPages,
  listShopPixels,
  sendMessengerImage,
  sendMessengerMessage,
  verifyWebhookSignature,
} from './meta.js';
import {
  TIKTOK_SCOPES,
  approveReturn,
  buildTikTokAuthorizeUrl,
  calculateRefund,
  consumeTikTokAuthState,
  createTikTokAuthState,
  exchangeAuthCode,
  findOrderByTikTokId,
  getAuthorizedShops,
  getOrderDetail,
  getProduct,
  listPayments,
  listStatementTransactions,
  listStatements,
  listWithdrawals,
  mapTikTokOrderToOrderInput,
  mapTikTokReturnStatus,
  refreshAccessToken,
  registerWebhook,
  rejectReturn,
  searchCancellations,
  searchOrders,
  searchProducts,
  searchReturns,
  sendCustomerServiceMessage,
  tiktokIsMasked,
  tiktokMoneyToVnd,
  tiktokPlatformConfigured,
  tiktokPlatformPublic,
  tiktokWebhookDedupeKey,
  updateProductInventory,
  updateProductPrices,
  upsertTikTokOrder,
  verifyTikTokWebhookSignature,
} from './tiktok.js';
import type {
  TikTokApiCall,
  TikTokFinanceRecord,
  TikTokMessage,
  TikTokOrder,
  TikTokReturn,
  TikTokReturnRecord,
  TikTokShopConfig,
  TikTokSkuMap,
  TikTokWebhookEvent,
} from './tiktok.js';
import {
  buildShopeeAuthorizeUrl,
  confirmShopeeLostPushMessage,
  consumeShopeeAuthState,
  createShopeeAuthState,
  exchangeShopeeAuthCode,
  getShopeeEscrowDetail,
  getShopeeItemBaseInfo,
  getShopeeItemList,
  getShopeeLostPushMessage,
  getShopeeModelList,
  getShopeeOrderDetail,
  getShopeeOrderList,
  getShopeePayoutDetail,
  getShopeeReturnList,
  getShopeeShopInfo,
  getShopeeTrackingInfo,
  getShopeeTrackingNumber,
  mapShopeeReturnStatus,
  refreshShopeeAccessToken,
  shopeeHostOf,
  shopeeIsMasked,
  shopeeMoneyToVnd,
  shopeePartnerKeyResetDate,
  shopeePlatformConfigured,
  shopeePlatformPublic,
  shopeeWebhookDedupeKey,
  updateShopeePrice,
  updateShopeeStock,
  upsertShopeeOrder,
  verifyShopeePushSignature,
  SHOPEE_ACCESS_TOKEN_TTL_S,
  SHOPEE_REFRESH_TOKEN_TTL_DAYS,
  SHOPEE_AUTH_MAX_DAYS,
} from './shopee.js';
import type {
  ShopeeCall,
  ShopeeEscrowDetail,
  ShopeeFinanceRecord,
  ShopeeItem,
  ShopeeModel,
  ShopeeOrderDetail,
  ShopeePlatformConfig,
  ShopeeReturnRecord,
  ShopeeShopConfig,
  ShopeeSkuMap,
  ShopeeWebhookEvent,
} from './shopee.js';

// ---------------------------------------------------------------------------
// Kiểu mở rộng ngoài types.ts (lưu kèm trong JSON, xem ghi chú đầu file)
// ---------------------------------------------------------------------------

export interface PageState {
  id: string;
  name?: string;
  accessToken?: string; // page token — KHÔNG trả về client
  shopKey: string;
  connectedAt?: string;
}

export interface ShopExt extends Shop {
  extraPages?: number;
  extraStaff?: number;
  carrierConfigs?: Record<string, CarrierConfig>;
  capiAccessToken?: string; // Conversions API token của shop — KHÔNG trả về client
  capiTestEventCode?: string;
  aiKeyHash?: string; // sha256 của khóa AI shop — KHÔNG trả về client
  aiKeyMasked?: string;
  aiKeyCreatedAt?: string;
  meta?: {
    appId?: string;
    appSecret?: string; // KHÔNG trả về client
    redirectUri?: string;
    userAccessToken?: string; // KHÔNG trả về client
    pages?: PageState[];
  };
  /** Cấu hình + token TikTok Shop của shop (xem src/tiktok.ts) — KHÔNG trả secret về client. */
  tiktok?: TikTokShopConfig;
  /** Cấu hình + token Shopee của shop (xem src/shopee.ts) — KHÔNG trả secret về client. */
  shopee?: ShopeeShopConfig;
  pickup?: {
    name?: string;
    phone?: string;
    address?: string;
    province?: string;
    district?: string;
    ward?: string;
  };
  loyaltyConfig?: Record<string, unknown>;
}

export interface OrderHistoryEntry {
  time: string;
  action: string;
  note?: string;
  by?: string;
}

export interface OrderExt extends Order {
  id: string; // id nội bộ; mã nghiệp vụ là `code` (ACH77000xxx)
  history?: OrderHistoryEntry[];
  shipHistory?: Array<Record<string, unknown>>;
  toDistrictId?: number;
  toWardCode?: string;
  source?: string;
  /** Mã đơn TikTok (dedupe theo mã đơn sàn). */
  tiktokOrderId?: string;
  /** Trạng thái gốc TikTok (UNPAID / AWAITING_SHIPMENT / ...). */
  tiktokStatus?: string;
  tiktokCurrency?: string;
  /** true = SĐT/địa chỉ bị TikTok che (chưa xin quyền dữ liệu nhạy cảm). */
  tiktokMasked?: boolean;
  tiktokShopCipher?: string;
  /** Mã đơn Shopee (order_sn — dedupe theo mã đơn sàn). */
  shopeeOrderSn?: string;
  /** Trạng thái gốc Shopee (UNPAID / READY_TO_SHIP / ...). */
  shopeeStatus?: string;
  shopeeCurrency?: string;
  /** true = SĐT/địa chỉ bị Shopee che (chưa xin quyền dữ liệu nhạy cảm). */
  shopeeMasked?: boolean;
  shopeeShopId?: string;
  printCount?: number;
  sample?: boolean;
  province?: string;
  district?: string;
  ward?: string;
}

export interface ConversationExt extends Conversation {
  internalNotes?: Array<{ id: string; text: string; at: string; by?: string }>;
  note?: string;
  hashtags?: string[];
  assigneeId?: string | null;
  assigneeName?: string | null;
  lastMessageAt?: string;
  lastMessageFrom?: string;
  nudgeSent?: boolean;
  source?: string;
  commentId?: string;
}

export interface CampaignExt extends Campaign {
  message?: string;
  pageId?: string;
  sent?: number;
  failed?: number;
  results?: Array<Record<string, unknown>>;
  at?: string;
  by?: string;
}

export interface CommentExt {
  id: string;
  shopKey: string;
  pageId?: string;
  postId?: string;
  fbId?: string;
  text?: string;
  from?: { id?: string; name?: string };
  at?: string;
  status?: string;
  reply?: string;
  read?: boolean;
}

export interface LiveSessionExt {
  id: string;
  shopKey: string;
  pageId?: string;
  title?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  comments?: Array<{ id: string; text: string; from?: unknown; at: string; ordered?: boolean; orderId?: string | null }>;
  by?: string;
  updatedAt?: string;
}

export interface AiDraftExt {
  id: string;
  shopKey: string;
  status: string;
  text?: string;
  reply?: string;
  reviewedBy?: string;
  rejectReason?: string;
}

export interface TrainChatExt {
  id: string;
  shopKey: string;
  question: string;
  answer: string;
  status: string;
  at?: string;
  by?: string;
  ruleId?: string;
}

export interface SupplierDebtExt {
  id: string;
  shopKey: string;
  supplierName?: string;
  total?: number;
  paid?: number;
  remaining?: number;
  status?: string;
}

export interface StockRecordExt {
  id: string;
  shopKey: string;
  productId?: string;
  sku?: string;
  quantity?: number;
  dir?: string;
  at?: string;
  by?: string;
}

export interface ReturnSlipExt {
  id: string;
  shopKey: string;
  orderId?: string;
  orderCode?: string;
  reason?: string;
  items?: unknown;
  status?: number;
  at?: string;
  by?: string;
  updatedAt?: string;
  carrierReturnReceived?: boolean;
  carrierReturnReceivedAt?: string;
  /** Mã return/cancellation TikTok đã map vào phiếu này (nếu có). */
  tiktokReturnId?: string;
  /** Mã hoàn/trả Shopee đã map vào phiếu này (nếu có). */
  shopeeReturnId?: string;
}

export interface LoyaltyExt {
  customerId: string;
  shopKey: string;
  points: number;
  coupons?: Array<{ code: string; pointsUsed: number; value: number; at: string }>;
}

export interface CommentScriptExt {
  id: string;
  shopKey: string;
  keywords?: string[];
  reply?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/** State + các collection mở rộng (khởi tạo lười khi thiếu). */
export interface StateExtFull extends State {
  comments: CommentExt[];
  liveSessions: LiveSessionExt[];
  aiDrafts: AiDraftExt[];
  trainChats: TrainChatExt[];
  supplierDebts: SupplierDebtExt[];
  stockRecords: StockRecordExt[];
  returnSlips: ReturnSlipExt[];
  loyalty: Record<string, LoyaltyExt>;
  records: Record<string, Record<string, any>>;
  singletons: Record<string, unknown>;
  careSettings: Record<string, Record<string, unknown>>;
  inviteSettings: Record<string, Record<string, unknown>>;
  commentScripts: CommentScriptExt[];
  dataIsolationApplied: boolean;
  superAdminSetup: boolean;
  /** TikTok Shop: map SKU nội bộ ↔ product_id/sku_id (đồng bộ 2 chiều). */
  tiktokSkuMaps: TikTokSkuMap[];
  /** TikTok Shop: đối soát tài chính (statement / transaction / payment / withdrawal). */
  tiktokFinance: TikTokFinanceRecord[];
  /** TikTok Shop: hoàn/trả/hủy đã đồng bộ. */
  tiktokReturns: TikTokReturnRecord[];
  /** TikTok Shop: event webhook đã nhận (dedupe + kiểm tra lại). */
  tiktokWebhookEvents: TikTokWebhookEvent[];
  /** TikTok Shop: tin nhắn đã gửi cho khách (chỉ khi scope chat được cấp). */
  tiktokMessages: TikTokMessage[];
  /** Shopee: map SKU nội bộ ↔ item_id/model_id (đồng bộ 2 chiều). */
  shopeeSkuMaps: ShopeeSkuMap[];
  /** Shopee: đối soát tài chính (escrow / payout). */
  shopeeFinance: ShopeeFinanceRecord[];
  /** Shopee: hoàn/trả đã đồng bộ. */
  shopeeReturns: ShopeeReturnRecord[];
  /** Shopee: event webhook (push) đã nhận (dedupe + kiểm tra lại). */
  shopeeWebhookEvents: ShopeeWebhookEvent[];
}

export function extState(state: State): StateExtFull {
  const s = state as unknown as StateExtFull;
  s.comments ??= [];
  s.liveSessions ??= [];
  s.aiDrafts ??= [];
  s.trainChats ??= [];
  s.supplierDebts ??= [];
  s.stockRecords ??= [];
  s.returnSlips ??= [];
  s.loyalty ??= {};
  s.records ??= {};
  s.singletons ??= {};
  s.careSettings ??= {};
  s.inviteSettings ??= {};
  s.commentScripts ??= [];
  s.dataIsolationApplied ??= false;
  s.superAdminSetup ??= false;
  s.tiktokSkuMaps ??= [];
  s.tiktokFinance ??= [];
  s.tiktokReturns ??= [];
  s.tiktokWebhookEvents ??= [];
  s.tiktokMessages ??= [];
  s.shopeeSkuMaps ??= [];
  s.shopeeFinance ??= [];
  s.shopeeReturns ??= [];
  s.shopeeWebhookEvents ??= [];
  return s;
}

/** ctx từ server.ts ({account, shopKey, ...}) hoặc dạng brief ({role, shopKey, accountId, isSuperAdmin}). */
export interface ActionContext {
  role?: string;
  shopKey?: string | null;
  accountId?: string;
  isSuperAdmin?: boolean;
  account?: Account | null;
  hostShopKey?: string | null;
  version?: string;
}

export type ActionResult = { ok: boolean; error?: string; [key: string]: unknown };

export const SUPPORT_HOTLINE = '0916636785';

/** 8 bước trạng thái đơn (thứ tự theo types.ts ORDER_STATUS_LABELS). */
export const ORDER_STATUS_STEPS: OrderStatus[] = [
  'cho_duyet',
  'cho_dong_goi',
  'cho_lay_hang',
  'dang_giao_hang',
  'da_giao_hang',
  'huy_giao',
  'da_huy',
  'hoan_hang',
];

function toOrderStatus(v: unknown): OrderStatus | undefined {
  if (typeof v === 'string' && (ORDER_STATUS_STEPS as string[]).includes(v)) return v as OrderStatus;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= 8) return ORDER_STATUS_STEPS[n - 1];
  return undefined;
}

// ---------------------------------------------------------------------------
// ACTION_NAMES — đủ tên action v37 (đăng ký trong dispatcher, không thiếu tên nào)
// Lưu ý: brief ghi 131 tên nhưng danh sách liệt kê trong brief chỉ có 129 tên
// duy nhất (đã đếm tay + đếm bằng script); đăng ký đúng 129 tên đó, không bịa thêm.
// Cả 'saveshipfeerules' và 'saveshopshipfeerules' đều có mặt theo yêu cầu.
// ---------------------------------------------------------------------------
export const ACTION_NAMES: string[] = [
  'addinternalnote',
  'addlivecomment',
  'adjustcostprice',
  'adjustloyaltypoints',
  'advancereturnslip',
  'aianalyzereview',
  'aichat',
  'aiextractorder',
  'aigeneratecontent',
  'aiproposerule',
  'aisuggestnote',
  'appendlocalmessage',
  'applypershopdataisolation',
  'applypickuppointconfig',
  'applyproductshipfeerules',
  'applystockaudit',
  'applystockbatch',
  'applystockin',
  'applystocktransfer',
  'applyxinhorderprice',
  'approveaidraft',
  'approvetiktokreturn',
  'assignconversation',
  'assistantchat',
  'attachwaybilltoorder',
  'bestwebhookreceive',
  'bulkorderaction',
  'calculatetiktokrefund',
  'cancelwaybill',
  'changeorderstatus',
  'checkcontractfees',
  'checkshopaikey',
  'cleartrainchat',
  'confirmcarrierreturnreceived',
  'confirmtrainrule',
  'connectfanpages',
  'connectpagewithtoken',
  'createcashentry',
  'createorder',
  'createreturnslip',
  'createshopaccount',
  'deleteairule',
  'deletechathashtag',
  'deleteinternalnote',
  'deletelivecomment',
  'deletelivesession',
  'deleteorder',
  'deleteproduct',
  'deleterecordbykind',
  'deleteshop',
  'deleteshopaccount',
  'disconnectcarrier',
  'disconnectfanpage',
  'disconnectshopee',
  'disconnectshopcapipixel',
  'disconnecttiktok',
  'endlivesession',
  'exchangeoauthcode',
  'exchangeshopeecode',
  'exchangetiktokcode',
  'generateclaudeapikey',
  'getbootstrap',
  'getcapiconfig',
  'getcaresettings',
  'getclaudeconnection',
  'getinvitesettings',
  'getoauthurl',
  'getorderhistory',
  'getshopeechannels',
  'getshopeelostpush',
  'getshopeeoauthurl',
  'getshopeeplatformconfig',
  'getshopeeproducts',
  'getshopeetracking',
  'getshopquota',
  'gettrainchat',
  'gettiktokchannels',
  'gettiktokoauthurl',
  'gettiktokplatformconfig',
  'gettiktokproducts',
  'listshopmetapixels',
  'loginaccount',
  'mapshopeesku',
  'maptiktoksku',
  'markcommentsread',
  'marklivecommentordered',
  'migratemetaconnections',
  'paysupplierdebt',
  'precheckbulkship',
  'printcarrierwaybill',
  'processaiqueue',
  'processcommentqueue',
  'pushcommenttoinbox',
  'pushorderstocarrier',
  'pushshopeestock',
  'pushtiktokstock',
  'quotecarrierfee',
  'receivewebhookevent',
  'recordorderprint',
  'redeempointsforcoupon',
  'refreshcampaignstats',
  'refreshshopeetoken',
  'refreshtiktoktoken',
  'refreshwaybillstatus',
  'registertiktokwebhook',
  'rejectaidraft',
  'rejecttiktokreturn',
  'replycommentpublic',
  'resendcapipurchase',
  'revealclaudeapikey',
  'runcarenudges',
  'saveairule',
  'savecapiconfig',
  'savecaresettings',
  'savecarrierconfig',
  'savecommentscript',
  'saveconversationnote',
  'saveinvitesettings',
  'savelivesession',
  'saveloyaltyconfig',
  'savemetaconfig',
  'saveproduct',
  'saverecord',
  'savsaasconfig',
  'saveshipfeerules',
  'saveshopeeplatformconfig',
  'saveshop',
  'saveshopcapipixel',
  'saveshopshipfeerules',
  'savesingleton',
  'savetiktokplatformconfig',
  'scancodreconciliation',
  'seedinitialdata',
  'seedquickreplytemplates',
  'seedsampleorders',
  'sendcampaign',
  'sendcapitestevent',
  'sendchatimage',
  'sendchatmessage',
  'sendtiktokmessage',
  'setconversationhashtags',
  'setshopaikey',
  'setupsuperadmin',
  'shopeepoll',
  'shopeewebhookreceive',
  'startlivesession',
  'synccomments',
  'syncconversations',
  'syncshopeefinance',
  'syncshopeeorders',
  'syncshopeeproducts',
  'syncshopeereturns',
  'synctiktokfinance',
  'synctiktokorders',
  'synctiktokproducts',
  'synctiktokreturns',
  'testcarrierconnection',
  'tiktokpoll',
  'tiktokwebhookreceive',
  'trackwaybill',
  'trainchat',
  'unmapshopeesku',
  'unmaptiktoksku',
  'updatechathashtag',
  'updateorder',
  'updateshopaccount',
  'updatevariantstock',
  'verifyclaudeapikey',
  'verifyfacebooktoken',
  'verifywebhook',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function ok(data: Record<string, unknown> = {}): ActionResult {
  return { ok: true, ...data };
}

/** ctx helpers — hỗ trợ cả dạng server.ts ({account,...}) và dạng brief. */
export function ctxIsSuperAdmin(ctx: ActionContext): boolean {
  if (ctx.isSuperAdmin !== undefined) return ctx.isSuperAdmin;
  const role = ctx.role ?? ctx.account?.role;
  return role === 'super_admin' || role === 'superadmin';
}

export function ctxShopKey(ctx: ActionContext): string | null {
  return ctx.shopKey ?? ctx.account?.shopKey ?? ctx.hostShopKey ?? null;
}

export function ctxAccountId(ctx: ActionContext): string | undefined {
  return ctx.accountId ?? ctx.account?.id;
}

export function ctxRole(ctx: ActionContext): Role {
  if (ctxIsSuperAdmin(ctx)) return 'super_admin';
  const r = (ctx.role ?? ctx.account?.role) as Role | undefined;
  return r === 'shop_owner' || r === 'staff' ? r : 'staff';
}

/** Ép shopKey từ ctx; Super Admin mới được dùng shopKey client gửi. */
function effectiveShopKey(ctx: ActionContext, args: Record<string, any>): string | undefined {
  if (ctxIsSuperAdmin(ctx)) return (args.shopKey as string) || ctxShopKey(ctx) || undefined;
  return ctxShopKey(ctx) || undefined;
}

function requireShop(ctx: ActionContext, args: Record<string, any>): string | ActionResult {
  const sk = effectiveShopKey(ctx, args);
  if (!sk) return fail('Chưa xác định được shop. Đăng nhập lại rồi thử lại.');
  return sk;
}

function canAccess(ctx: ActionContext, shopKey?: string | null): boolean {
  if (ctxIsSuperAdmin(ctx)) return true;
  const sk = ctxShopKey(ctx);
  return !!shopKey && !!sk && sk === shopKey;
}

function requireSuperAdmin(ctx: ActionContext): ActionResult | null {
  return ctxIsSuperAdmin(ctx) ? null : fail('Chỉ Super Admin mới được thực hiện thao tác này.');
}

function hotline(state: State): string {
  return state.saasConfig?.hotline ?? SUPPORT_HOTLINE;
}

function quotaError(state: State, kind: 'page' | 'staff', limit: number): string {
  const what = kind === 'page' ? 'fanpage' : 'nhân viên';
  const price = kind === 'page' ? state.saasConfig?.extraPagePrice : state.saasConfig?.extraStaffPrice;
  const priceText = price ? ` Mua thêm ${price.toLocaleString('vi-VN')}đ/tháng/1 ${what} hoặc nâng gói.` : ` Mua thêm 20.000đ/tháng/1 ${what} hoặc nâng gói.`;
  return `Shop đã đạt hạn mức ${what} (${limit}).${priceText} Liên hệ tổng đài ${hotline(state)}.`;
}

/** Hạn mức page/nhân viên của shop: Shop.pageLimit/staffLimit, cộng mua thêm. */
function shopLimits(state: State, shop: Shop): { pages: number; staff: number } {
  const e = shop as ShopExt;
  let pages = shop.pageLimit;
  let staff = shop.staffLimit;
  if (pages === undefined || staff === undefined) {
    const plan = state.saasConfig?.plans?.find((p) => p.key === shop.plan);
    pages = plan?.pageLimit ?? 1;
    staff = plan?.staffLimit ?? 1;
  }
  return { pages: pages + (e.extraPages ?? 0), staff: staff + (e.extraStaff ?? 0) };
}

/** Redirect URI Meta chỉ nhận địa chỉ web thật (sửa lỗi redirect_uri=null 17:18). */
export function isValidRedirectUri(uri: string): boolean {
  if (!uri) return false;
  const u = uri.trim();
  if (!u || u === 'null' || u.startsWith('null')) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function invalidRedirectUriError(): string {
  return 'Redirect URI chưa đúng: nhập địa chỉ web thật của app (vd https://tenshop.achat.vn/ hoặc địa chỉ Render sau khi deploy), không để trống hay "null". Đăng ký đúng địa chỉ này trong Meta App: Miền ứng dụng (achat.vn) + Facebook Login > URI chuyển hướng OAuth hợp lệ, rồi đăng nhập lại.';
}

function getShop(state: State, shopKey: string): Shop | undefined {
  return state.shops.find((s) => s.key === shopKey);
}

function shopOrders(state: State, shopKey: string): Order[] {
  return state.orders.filter((o) => o.shopKey === shopKey);
}

function findOrder(state: State, ctx: ActionContext, codeOrId: string): Order | undefined {
  const o =
    state.orders.find((x) => x.code === codeOrId) ??
    state.orders.find((x) => (x as OrderExt).id === codeOrId);
  if (!o) return undefined;
  if (!canAccess(ctx, o.shopKey)) return undefined;
  return o;
}

/** Cấu hình CAPI (kiểu của capi.ts) từ state: pixel ở capiConfigByShop, token ở ShopExt. */
function shopCapiLibConfig(state: State, shopKey: string): LibCapiConfig {
  const shop = getShop(state, shopKey) as ShopExt | undefined;
  const cfg = state.capiConfigByShop[shopKey];
  return {
    pixelId: cfg?.pixelId,
    accessToken: shop?.capiAccessToken,
    enabled: cfg?.connected !== false,
    testEventCode: shop?.capiTestEventCode,
  };
}

function mapLibCapiStatus(s: LibCapiStatus): OrderCapiStatus {
  switch (s) {
    case 'sent': return 'da_gui';
    case 'no_pixel': return 'chua_ket_noi';
    case 'failed': return 'loi';
    default: return 'chua_gui';
  }
}

function publicShop(state: State, s: Shop): Record<string, unknown> {
  const e = s as ShopExt;
  const copy: Record<string, unknown> = { ...s };
  if (e.meta) {
    const m = { ...(e.meta as Record<string, unknown>) };
    delete m.appSecret;
    delete m.userAccessToken;
    if (Array.isArray(m.pages)) {
      m.pages = (m.pages as PageState[]).map((p) => ({ id: p.id, name: p.name, shopKey: p.shopKey, connectedAt: p.connectedAt }));
    }
    copy.meta = m;
  }
  if (e.tiktok) {
    // TikTok: chỉ trả trạng thái + thông tin không nhạy cảm; secret/token KHÔNG ra client.
    const t = { ...(e.tiktok as unknown as Record<string, unknown>) };
    delete t.appSecret;
    delete t.accessToken;
    delete t.refreshToken;
    if (typeof t.appKey === 'string' && t.appKey) t.appKey = maskSecret(String(t.appKey));
    if (typeof t.shopCipher === 'string' && t.shopCipher) t.shopCipher = maskSecret(String(t.shopCipher));
    copy.tiktok = t;
  }
  if (e.shopee) {
    // Shopee: chỉ trả trạng thái + thông tin không nhạy cảm; token KHÔNG ra client.
    const s = { ...(e.shopee as unknown as Record<string, unknown>) };
    delete s.accessToken;
    delete s.refreshToken;
    copy.shopee = s;
  }
  if (e.carrierConfigs) {
    const cc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.carrierConfigs)) {
      const c = { ...(v as unknown as Record<string, unknown>) };
      if (c.token) c.token = maskSecret(String(c.token));
      if (c.jwt) c.jwt = maskSecret(String(c.jwt));
      if (c.password) c.password = '****';
      if (c.privateKey) c.privateKey = '****';
      cc[k] = c;
    }
    copy.carrierConfigs = cc;
  }
  copy.capi = getCapiConfig(shopCapiLibConfig(state, s.key));
  delete copy.aiKeyHash;
  delete copy.capiAccessToken;
  delete copy.capiTestEventCode;
  copy.hasAiKey = Boolean(e.aiKeyHash);
  return copy;
}

function getCarrierConfig(state: State, shopKey: string, carrier: CarrierCode): CarrierConfig | undefined {
  const shop = getShop(state, shopKey) as ShopExt | undefined;
  const cfg = shop?.carrierConfigs?.[carrier];
  if (!cfg) return undefined;
  // Gộp địa chỉ lấy hàng của shop (GHTK/VTP cần pick_*/sender_*).
  const p = shop?.pickup;
  return {
    ...cfg,
    carrier,
    pickupName: cfg.pickupName ?? p?.name,
    pickupPhone: cfg.pickupPhone ?? p?.phone,
    pickupAddress: cfg.pickupAddress ?? p?.address,
    pickupProvince: cfg.pickupProvince ?? p?.province,
    pickupDistrict: cfg.pickupDistrict ?? p?.district,
    pickupWard: cfg.pickupWard ?? p?.ward,
  };
}

function getPageToken(state: State, shopKey: string, pageId?: string): { token?: string; page?: PageState } {
  const pages = (getShop(state, shopKey) as ShopExt | undefined)?.meta?.pages ?? [];
  const page = pageId ? pages.find((p) => p.id === pageId) : pages[0];
  return { token: page?.accessToken, page };
}

function orderToShipInput(o: Order, extra: Partial<ShipOrderInput> = {}): ShipOrderInput {
  const e = o as OrderExt;
  const pairs = o.items.reduce((s, l) => s + l.quantity, 0);
  return {
    orderCode: o.code,
    toName: o.customerName ?? '',
    toPhone: o.customerPhone ?? '',
    toAddress: o.customerAddress ?? '',
    toProvince: e.province ?? '',
    toDistrict: e.district ?? '',
    toWard: e.ward,
    toDistrictId: e.toDistrictId,
    toWardCode: e.toWardCode,
    codAmount: o.remainingCod,
    weightGrams: pairs * GRAMS_PER_PAIR,
    items: o.items.map((l) => ({ name: `${l.sku ? l.sku + ' ' : ''}${l.color ? l.color + ' ' : ''}${l.size ? 'size ' + l.size : ''}`.trim() || 'Dép', quantity: l.quantity, price: l.price })),
    note: o.note,
    ...extra,
  };
}

/** Chuẩn hoá quy tắc phí ship client gửi về đúng kiểu types.ts ShipFeeRule. */
function normalizeShipRules(input: unknown, shopKey: string): ShipFeeRule[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ShipFeeRule[] = [];
  for (const r of input as Array<Record<string, any>>) {
    // Dạng rút gọn cũ {fee, freeFromPairs} -> 2 rule theo khoảng số lượng.
    if (r.fee !== undefined && r.scope === undefined) {
      const fee = Number(r.fee);
      const freeFrom = Number(r.freeFromPairs ?? 2);
      out.push({ id: uid('rule'), name: `Ship ${fee.toLocaleString('vi-VN')}đ`, scope: 'all', groupName: null, productId: null, minQty: 1, maxQty: freeFrom - 1, fee, enabled: true });
      out.push({ id: uid('rule'), name: `Miễn ship từ ${freeFrom} đôi`, scope: 'all', groupName: null, productId: null, minQty: freeFrom, maxQty: null, fee: 0, enabled: true });
      continue;
    }
    const fee = Number(r.fee);
    if (!Number.isFinite(fee) || fee < 0) return null;
    const scope = r.scope === 'group' || r.scope === 'product' ? r.scope : 'all';
    out.push({
      id: String(r.id ?? uid('rule')),
      name: String(r.name ?? `Quy tắc ${out.length + 1}`),
      scope,
      groupName: scope === 'group' ? String(r.groupName ?? '') : null,
      productId: scope === 'product' ? String(r.productId ?? '') : null,
      minQty: Number(r.minQty ?? 1),
      maxQty: r.maxQty === null || r.maxQty === undefined ? null : Number(r.maxQty),
      fee,
      enabled: r.enabled !== false,
    });
  }
  void shopKey;
  return out;
}

// ---------------------------------------------------------------------------
// Rule-engine (trợ lý AI khi chưa nối LLM): khớp từ khóa + bảng giá + rule đã dạy
// ---------------------------------------------------------------------------

const COLOR_WORDS: Array<[RegExp, string]> = [
  [/đen|den\b/i, 'Đen'],
  [/nâu|nau\b/i, 'Nâu'],
  [/kem|trắng|trang|be\b/i, 'Kem'],
  [/xám|xam|ghi\b/i, 'Xám'],
];

function classifyIntent(text: string): 'hoc_sp' | 'len_don' | 'day_don' | 'xoa_don' | 'chat_thuong' {
  const t = text.toLowerCase();
  if (/(dạy|day|học|hoc|nhớ|nho|ghi nhớ).*(sản phẩm|san pham|giá|gia|mẫu|mau)/.test(t)) return 'hoc_sp';
  if (/(lên đơn|len don|tạo đơn|tao don|chốt|chot|đặt|dat).*(đơn|don)/.test(t) || /chốt đơn/.test(t)) return 'len_don';
  if (/(đẩy đơn|day don|gửi hàng|gui hang|giao hàng|ship)/.test(t)) return 'day_don';
  if (/(xóa đơn|xoa don|hủy đơn|huy don|xoá đơn)/.test(t)) return 'xoa_don';
  return 'chat_thuong';
}

/** Trả lời bằng rule-engine từ bảng giá + rule AI đã dạy của đúng shop. */
function ruleEngineReply(state: State, shopKey: string, text: string): { reply: string; intent: string; matchedRule?: string } {
  const intent = classifyIntent(text);
  const t = text.toLowerCase();
  const rules = state.aiRules.filter((r) => r.shopKey === shopKey && r.enabled);
  for (const r of rules) {
    const kws: string[] = Array.isArray(r.keywords) ? r.keywords : [];
    if (kws.some((k) => k && t.includes(String(k).toLowerCase()))) {
      return { reply: String(r.reply ?? ''), intent, matchedRule: r.id };
    }
  }
  const products = state.products.filter((p) => p.shopKey === shopKey);
  if (/giá|gia|bao nhiêu|bao nhieu/.test(t)) {
    if (products.length > 0) {
      const p = products[0];
      const price = p.price.toLocaleString('vi-VN');
      return {
        reply: `Dạ shop em có ${p.name} giá ${price}đ/đôi, 2 đôi 99k miễn ship ạ. Chị lấy mấy đôi, màu nào để em lên đơn cho chị nha?`,
        intent,
      };
    }
    return { reply: 'Dạ chị hỏi giá mẫu nào để em báo giá cho chị nha?', intent };
  }
  if (/size|sz|cỡ|co\b/.test(t)) {
    return { reply: 'Dạ shop em có size 36 đến 39 ạ. Chị thường đi size bao nhiêu để em tư vấn cho vừa chân ạ?', intent };
  }
  if (/ship|giao hàng|phí/.test(t)) {
    return { reply: 'Dạ 1 đôi ship 30k, từ 2 đôi shop em miễn ship ạ. Chị được kiểm tra hàng trước khi thanh toán ạ.', intent };
  }
  if (/địa chỉ|dia chi|shop ở đâu|o dau/.test(t)) {
    return { reply: 'Dạ shop em bán hàng online, gửi hàng đi toàn quốc, chị nhận trong 2-4 ngày tùy khu vực ạ.', intent };
  }
  return { reply: 'Dạ em nghe ạ, chị cần em tư vấn mẫu nào ạ?', intent };
}

/** Tách đơn từ tin nhắn khách: size, màu, SĐT (regex, không bịa). */
function extractOrderFromText(text: string): {
  lines: Array<{ color?: string; size?: string; quantity: number }>;
  phone?: string;
} {
  const lines: Array<{ color?: string; size?: string; quantity: number }> = [];
  const sizeMatches = [...text.matchAll(/\b(3[6-9]|40)\b/g)].map((m) => m[1]);
  const colors: string[] = [];
  for (const [re, name] of COLOR_WORDS) if (re.test(text)) colors.push(name);
  const phoneMatch = /(?<!\d)0\d{8,9}(?!\d)/.exec(text.replace(/[\s.\-]/g, ''));
  const phone = phoneMatch ? phoneMatch[0] : undefined;
  if (sizeMatches.length > 0 || colors.length > 0) {
    if (sizeMatches.length > 0 && colors.length > 0) {
      for (const s of sizeMatches) for (const c of colors) lines.push({ color: c, size: s, quantity: 1 });
    } else if (sizeMatches.length > 0) {
      for (const s of sizeMatches) lines.push({ size: s, quantity: 1 });
    } else {
      for (const c of colors) lines.push({ color: c, quantity: 1 });
    }
  }
  return { lines, phone };
}

// ---------------------------------------------------------------------------
// Handlers: bootstrap / auth / shop / quota
// ---------------------------------------------------------------------------

function hGetBootstrap(state: State, ctx: ActionContext): ActionResult {
  const scoped = scopeState(state, ctxRole(ctx), ctxShopKey(ctx));
  const E = extState(state);
  const sk = ctxShopKey(ctx);
  const shopFilter = (x: { shopKey?: string | null }): boolean => ctxIsSuperAdmin(ctx) || x.shopKey === sk;
  return ok({
    shops: scoped.shops.map((s: Shop) => publicShop(state, s)),
    accounts: scoped.accounts.map((a: Account) => toPublicAccount(a)),
    orders: scoped.orders,
    products: scoped.products,
    customers: scoped.customers,
    conversations: scoped.conversations,
    fanpages: scoped.fanpages,
    shipFeeRulesByShop: scoped.shipFeeRulesByShop,
    shipFeeRules: scoped.shipFeeRules,
    aiRules: scoped.aiRules,
    carriers: scoped.carriers,
    coupons: scoped.coupons,
    campaigns: scoped.campaigns,
    cashEntries: scoped.cashEntries,
    loyaltyConfig: scoped.loyaltyConfig,
    saasConfig: scoped.saasConfig,
    shippingConfig: scoped.shippingConfig,
    metaConfig: scoped.metaConfig,
    capiConfigByShop: scoped.capiConfigByShop,
    hashtags: scoped.hashtags,
    quickReplies: scoped.quickReplies,
    comments: E.comments.filter(shopFilter),
    liveSessions: E.liveSessions.filter(shopFilter),
    aiDrafts: E.aiDrafts.filter(shopFilter),
    trainChats: E.trainChats.filter(shopFilter),
    supplierDebts: E.supplierDebts.filter(shopFilter),
    stockRecords: E.stockRecords.filter(shopFilter),
    returnSlips: E.returnSlips.filter(shopFilter),
    commentScripts: E.commentScripts.filter(shopFilter),
    tiktokSkuMaps: E.tiktokSkuMaps.filter(shopFilter),
    tiktokFinance: E.tiktokFinance.filter(shopFilter),
    tiktokReturns: E.tiktokReturns.filter(shopFilter),
    tiktokWebhookEvents: E.tiktokWebhookEvents.filter(shopFilter),
    tiktokMessages: E.tiktokMessages.filter(shopFilter),
    shopeeSkuMaps: E.shopeeSkuMaps.filter(shopFilter),
    shopeeFinance: E.shopeeFinance.filter(shopFilter),
    shopeeReturns: E.shopeeReturns.filter(shopFilter),
    shopeeWebhookEvents: E.shopeeWebhookEvents.filter(shopFilter),
    // Bản ghi generic theo kind (review, coupon, campaign...) — lọc theo shop.
    records: Object.fromEntries(
      Object.entries(E.records || {}).map(([k, v]) => [
        k,
        Object.values(v as Record<string, any>).filter(shopFilter),
      ]),
    ),
    dataIsolationApplied: E.dataIsolationApplied,
    superAdminSetup: E.superAdminSetup,
  });
}

function hLoginAccount(state: State, args: Record<string, any>): ActionResult {
  const identifier = String(args.identifier ?? args.email ?? args.username ?? '').trim();
  const password = String(args.password ?? '');
  if (!identifier || !password) return fail('Thiếu email/tên đăng nhập hoặc mật khẩu.');
  const r = loginAccount(state, identifier, password);
  if (!r.ok) return fail(r.error);
  const acc = r.account;
  return ok({
    account: acc,
    token: acc.id,
    shopKey: acc.shopKey,
    role: acc.role,
    isSuperAdmin: acc.role === 'super_admin',
  });
}

function hGetShopQuota(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk);
  if (!shop) return fail('Không tìm thấy shop.');
  const limits = shopLimits(state, shop);
  const pagesUsed = state.fanpages.filter((f) => f.shopKey === sk).length;
  const staffUsed = state.accounts.filter((a) => a.shopKey === sk).length;
  return ok({
    shopKey: sk,
    plan: shop.plan,
    pages: { limit: limits.pages, used: pagesUsed },
    staff: { limit: limits.staff, used: staffUsed },
  });
}

// ---------------------------------------------------------------------------
// Handlers: đơn hàng
// ---------------------------------------------------------------------------

function resolveOrderItems(
  state: State,
  shopKey: string,
  rawLines: Array<Record<string, any>>,
  allowShared = false,
): OrderItem[] {
  const items: OrderItem[] = [];
  for (const l of rawLines) {
    const sku = String(l.sku ?? '').trim();
    const byId = l.productId ? state.products.find((p) => p.id === String(l.productId)) : undefined;
    const bySku =
      sku === ''
        ? undefined
        : state.products.find(
            (p) =>
              (p.shopKey === shopKey || (allowShared && p.shopKey === 'shared')) &&
              p.variants.some((v) => v.sku === sku),
          );
    const byName =
      !byId && !bySku && l.name
        ? state.products.find((p) => p.shopKey === shopKey && p.name === String(l.name))
        : undefined;
    const product = byId ?? bySku ?? byName;
    // SKU/biến thể không tìm thấy mà cũng không kèm giá tay -> lỗi rõ ràng
    // thay vì lặng lẽ tạo đơn 0đ (lỗi từng gặp ở smoke test 09-11-2026).
    if (!product && l.price === undefined) {
      throw new Error(
        `Không tìm thấy sản phẩm cho dòng hàng ${sku || String(l.name ?? '')} ở shop ${shopKey}. Kiểm tra lại SKU/mã sản phẩm.`,
      );
    }
    const variant = sku === '' ? undefined : product?.variants.find((v) => v.sku === sku);
    const price = Number(l.price ?? product?.price ?? 0);
    const quantity = Number(l.quantity ?? 1);
    items.push({
      productId: String(l.productId ?? product?.id ?? ''),
      sku,
      color: String(l.color ?? variant?.color ?? ''),
      size: String(l.size ?? variant?.size ?? ''),
      quantity,
      price,
    });
  }
  return items;
}

async function hCreateOrder(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk);
  if (!shop) return fail('Không tìm thấy shop.');
  const rawLines: Array<Record<string, any>> = Array.isArray(args.lines) ? args.lines : Array.isArray(args.items) ? args.items : [];
  if (rawLines.length === 0) return fail('Đơn hàng chưa có sản phẩm.');
  let items: OrderItem[];
  try {
    items = resolveOrderItems(state, sk, rawLines, ctxIsSuperAdmin(ctx));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Dòng sản phẩm không hợp lệ.');
  }
  for (const it of items) {
    if (!(it.quantity > 0) || !(it.price >= 0)) return fail('Dòng sản phẩm thiếu số lượng/giá hợp lệ.');
  }
  const discount = Number(args.discount ?? args.discountAmount ?? 0);
  const totals = computeOrderTotals(state, sk, items, { couponDiscount: discount });
  let note = typeof args.note === 'string' ? args.note : '';
  // Note đơn tạo từ chat phải bắt đầu "Khách đặt: ..."
  const noteFromLines = `Khách đặt: ${items.map((l) => `${l.quantity} đôi ${l.size ? 'size ' + l.size + ' ' : ''}${l.color ? l.color + ' ' : ''}${l.sku || ''}`.trim()).join(' + ')}`;
  if (args.fromChat && note && !note.startsWith('Khách đặt:')) note = `Khách đặt: ${note}`;
  if (args.fromChat && !note) note = noteFromLines;
  const code = nextOrderCode(state);
  const now = nowIso();
  const order = {
    id: uid('ord'),
    code,
    shopKey: sk,
    customerName: String(args.customerName ?? args.name ?? ''),
    customerPhone: String(args.phone ?? args.customerPhone ?? ''),
    customerAddress: String(args.address ?? args.customerAddress ?? ''),
    province: args.province,
    district: args.district,
    ward: args.ward,
    toDistrictId: args.toDistrictId,
    toWardCode: args.toWardCode,
    items,
    goodsTotal: totals.goodsTotal,
    shippingFee: totals.shippingFee,
    discountAmount: discount,
    totalAmount: totals.totalAmount,
    remainingCod: totals.remainingCod,
    orderStatus: 'cho_duyet' as OrderStatus,
    carrier: '',
    waybillCode: '',
    note,
    source: args.source ?? (args.fromChat ? 'chat' : 'manual'),
    capiStatus: 'chua_gui' as OrderCapiStatus,
    capiLog: '',
    history: [{ time: now, action: 'create', note: `Tạo đơn ${code}`, by: ctxAccountId(ctx) }],
    createdAt: now,
    updatedAt: now,
  } satisfies OrderExt;
  state.orders.push(order);

  // CAPI: tự gửi Purchase khi tạo đơn xong (không làm hỏng việc tạo đơn nếu lỗi).
  const capiCfg = shopCapiLibConfig(state, sk);
  if (capiCfg.pixelId && capiCfg.accessToken && capiCfg.enabled !== false) {
    const r = await sendPurchaseEvent({
      pixelId: capiCfg.pixelId,
      accessToken: capiCfg.accessToken,
      orderCode: code,
      phone: order.customerPhone,
      name: order.customerName,
      value: order.remainingCod,
      skus: items.map((l) => l.sku).filter(Boolean),
      testEventCode: capiCfg.testEventCode,
    });
    order.capiStatus = mapLibCapiStatus(r.status);
    order.capiLog = r.message;
  } else {
    order.capiStatus = 'chua_ket_noi';
    order.capiLog = 'Chưa kết nối Pixel nên đơn chưa được báo về Facebook.';
  }
  return ok({ order });
}

function hUpdateOrder(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng (hoặc đơn không thuộc shop của bạn).');
  if (args.orderStatus !== undefined) {
    return fail('Không đổi trạng thái đơn qua updateorder. Dùng changeorderstatus để đổi trạng thái (có ghi history).');
  }
  const e = order as OrderExt;
  if (args.customerName !== undefined) order.customerName = String(args.customerName);
  if (args.phone !== undefined) order.customerPhone = String(args.phone);
  if (args.customerPhone !== undefined) order.customerPhone = String(args.customerPhone);
  if (args.address !== undefined) order.customerAddress = String(args.address);
  if (args.customerAddress !== undefined) order.customerAddress = String(args.customerAddress);
  if (args.province !== undefined) e.province = args.province;
  if (args.district !== undefined) e.district = args.district;
  if (args.ward !== undefined) e.ward = args.ward;
  if (args.toDistrictId !== undefined) e.toDistrictId = args.toDistrictId;
  if (args.toWardCode !== undefined) e.toWardCode = args.toWardCode;
  if (args.note !== undefined) order.note = String(args.note);
  if (args.discount !== undefined || args.discountAmount !== undefined) {
    order.discountAmount = Number(args.discount ?? args.discountAmount ?? 0);
  }
  if (Array.isArray(args.lines) || Array.isArray(args.items)) {
    try {
      order.items = resolveOrderItems(state, order.shopKey, (args.lines ?? args.items) as Array<Record<string, any>>, ctxIsSuperAdmin(ctx));
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Dòng sản phẩm không hợp lệ.');
    }
  }
  const totals = computeOrderTotals(state, order.shopKey, order.items, { couponDiscount: order.discountAmount });
  order.goodsTotal = totals.goodsTotal;
  order.shippingFee = totals.shippingFee;
  order.totalAmount = totals.totalAmount;
  // remainingCod patch riêng theo totalAmount (AChatGo không tự đổi theo khi sửa tay).
  order.remainingCod = totals.remainingCod;
  order.updatedAt = nowIso();
  e.history = [...(e.history ?? []), { time: nowIso(), action: 'update', note: 'Cập nhật đơn', by: ctxAccountId(ctx) }];
  return ok({ order });
}

function hDeleteOrder(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng (hoặc đơn không thuộc shop của bạn).');
  if (args.confirm !== true) {
    return fail('Xóa đơn cần xác nhận. UI phải hỏi xác nhận trước rồi gọi lại với confirm:true.');
  }
  const idx = state.orders.indexOf(order);
  if (idx >= 0) state.orders.splice(idx, 1);
  return ok({ deletedId: (order as OrderExt).id, code: order.code });
}

function hChangeOrderStatus(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng (hoặc đơn không thuộc shop của bạn).');
  const status = toOrderStatus(args.orderStatus ?? args.status);
  if (!status) {
    return fail(`Trạng thái đơn không hợp lệ. Dùng 1 trong 8 bước: ${ORDER_STATUS_STEPS.map((s) => `${s} (${ORDER_STATUS_LABELS[s]})`).join(', ')}.`);
  }
  const e = order as OrderExt;
  const from = order.orderStatus;
  order.orderStatus = status;
  order.updatedAt = nowIso();
  e.history = [...(e.history ?? []), { time: nowIso(), action: 'changeStatus', note: `Đổi trạng thái ${ORDER_STATUS_LABELS[from]} -> ${ORDER_STATUS_LABELS[status]}${args.note ? ': ' + args.note : ''}`, by: ctxAccountId(ctx) }];
  return ok({ order });
}

function hBulkOrderAction(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const ids: string[] = Array.isArray(args.orderIds) ? args.orderIds : [];
  if (ids.length === 0) return fail('Chưa chọn đơn nào.');
  const action = String(args.action ?? args.bulkAction ?? '');
  const results: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const order = findOrder(state, ctx, id);
    if (!order) { results.push({ orderId: id, ok: false, error: 'Không tìm thấy đơn.' }); continue; }
    if (action === 'changeStatus') {
      const r = hChangeOrderStatus(state, ctx, { orderId: id, orderStatus: args.orderStatus, note: args.note });
      results.push({ orderId: id, ...r });
    } else if (action === 'delete') {
      if (args.confirm !== true) { results.push({ orderId: id, ok: false, error: 'Xóa đơn cần confirm:true.' }); continue; }
      const idx = state.orders.indexOf(order);
      if (idx >= 0) state.orders.splice(idx, 1);
      results.push({ orderId: id, ok: true, deleted: true });
    } else {
      results.push({ orderId: id, ok: false, error: `Bulk action không hỗ trợ: ${action}.` });
    }
  }
  return ok({ results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}

function hGetOrderHistory(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng (hoặc đơn không thuộc shop của bạn).');
  return ok({ orderId: (order as OrderExt).id, code: order.code, history: (order as OrderExt).history ?? [] });
}

function hRecordOrderPrint(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng.');
  const e = order as OrderExt;
  e.printCount = (e.printCount ?? 0) + 1;
  e.history = [...(e.history ?? []), { time: nowIso(), action: 'print', note: `In đơn lần ${e.printCount} (${args.template ?? 'mẫu mặc định'})`, by: ctxAccountId(ctx) }];
  return ok({ orderId: e.id, code: order.code, printCount: e.printCount });
}

function hScanCodReconciliation(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = ctxIsSuperAdmin(ctx) ? undefined : ctxShopKey(ctx);
  const mismatches: Array<Record<string, unknown>> = [];
  let checked = 0;
  for (const order of state.orders) {
    if (sk && order.shopKey !== sk) continue;
    checked++;
    const t = computeOrderTotals(state, order.shopKey, order.items, { couponDiscount: order.discountAmount });
    if (t.totalAmount !== order.totalAmount || t.remainingCod !== order.remainingCod) {
      mismatches.push({ orderId: (order as OrderExt).id, code: order.code, storedTotal: order.totalAmount, computedTotal: t.totalAmount, storedCod: order.remainingCod, computedCod: t.remainingCod });
    }
  }
  void args;
  return ok({ checked, mismatches, mismatchCount: mismatches.length });
}

// ---------------------------------------------------------------------------
// Handlers: sản phẩm / kho
// ---------------------------------------------------------------------------

function normalizeVariants(input: unknown): Variant[] {
  if (!Array.isArray(input)) return [];
  return (input as Array<Record<string, any>>).map((v) => ({
    sku: String(v.sku ?? ''),
    color: String(v.color ?? ''),
    size: String(v.size ?? ''),
    stock: v.stock !== undefined ? Number(v.stock) : -1,
    costPrice: v.costPrice !== undefined ? Number(v.costPrice) : 0,
  }));
}

function hSaveProduct(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const p = args.product ?? args;
  if (!p.name || !(Number(p.price) >= 0)) return fail('Sản phẩm thiếu tên hoặc giá.');
  const id = String(p.id ?? uid('prd'));
  const existing = state.products.find((x) => x.id === id);
  if (existing && !canAccess(ctx, existing.shopKey)) return fail('Sản phẩm không thuộc shop của bạn.');
  const product: Product = {
    id,
    shopKey: sk,
    name: String(p.name),
    groupName: String(p.groupName ?? existing?.groupName ?? ''),
    price: Number(p.price),
    image: String(p.image ?? existing?.image ?? ''),
    variants: Array.isArray(p.variants) ? normalizeVariants(p.variants) : existing?.variants ?? [],
    createdAt: existing?.createdAt ?? nowIso(),
  };
  if (existing) {
    const idx = state.products.indexOf(existing);
    state.products[idx] = product;
  } else {
    state.products.push(product);
  }
  return ok({ product });
}

function hDeleteProduct(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const id = String(args.productId ?? args.id ?? '');
  const idx = state.products.findIndex((p) => p.id === id);
  if (idx < 0 || !canAccess(ctx, state.products[idx].shopKey)) return fail('Không tìm thấy sản phẩm (hoặc sản phẩm không thuộc shop của bạn).');
  state.products.splice(idx, 1);
  return ok({ deletedId: id });
}

function hUpdateVariantStock(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const p = state.products.find((x) => x.id === String(args.productId ?? ''));
  if (!p || !canAccess(ctx, p.shopKey)) return fail('Không tìm thấy sản phẩm (hoặc sản phẩm không thuộc shop của bạn).');
  const v = p.variants.find((x) => x.sku === args.sku);
  if (!v) return fail(`Không tìm thấy biến thể SKU ${args.sku}.`);
  if (args.stock !== undefined) v.stock = Number(args.stock);
  else {
    const delta = Number(args.delta ?? args.change ?? 0);
    v.stock = v.stock === -1 ? Math.max(0, delta) : Math.max(0, v.stock + delta);
  }
  return ok({ product: p, variant: v });
}

function applyStockChange(state: State, ctx: ActionContext, args: Record<string, any>, dir: 'in' | 'out'): ActionResult {
  const E = extState(state);
  const p = state.products.find((x) => x.id === String(args.productId ?? ''));
  if (!p || !canAccess(ctx, p.shopKey)) return fail('Không tìm thấy sản phẩm (hoặc sản phẩm không thuộc shop của bạn).');
  const v = p.variants.find((x) => x.sku === args.sku);
  if (!v) return fail(`Không tìm thấy biến thể SKU ${args.sku}.`);
  const qty = Number(args.quantity ?? 0);
  if (!(qty > 0)) return fail('Số lượng nhập/xuất phải lớn hơn 0.');
  if (dir === 'in') v.stock = v.stock === -1 ? qty : v.stock + qty;
  else {
    if (v.stock !== -1 && v.stock < qty) return fail(`Tồn kho chỉ còn ${v.stock}, không đủ xuất ${qty}.`);
    if (v.stock !== -1) v.stock -= qty;
  }
  const rec: StockRecordExt = { id: uid('stk'), shopKey: p.shopKey, productId: p.id, sku: v.sku, quantity: qty, dir, at: nowIso(), by: ctxAccountId(ctx) };
  E.stockRecords.push(rec);
  return ok({ product: p, variant: v, record: rec });
}

function hApplyStockIn(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  return applyStockChange(state, ctx, args, 'in');
}

function hApplyStockBatch(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const items: any[] = Array.isArray(args.items) ? args.items : [];
  if (items.length === 0) return fail('Danh sách nhập kho trống.');
  const results = items.map((it) => applyStockChange(state, ctx, it, 'in'));
  return ok({ results, succeeded: results.filter((r) => r.ok).length });
}

function hApplyStockAudit(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const items: any[] = Array.isArray(args.items) ? args.items : [];
  if (items.length === 0) return fail('Danh sách kiểm kê trống.');
  const diffs: Array<Record<string, unknown>> = [];
  for (const it of items) {
    const p = state.products.find((x) => x.id === String(it.productId ?? ''));
    if (!p || !canAccess(ctx, p.shopKey)) { diffs.push({ ...it, ok: false, error: 'Không tìm thấy sản phẩm.' }); continue; }
    const v = p.variants.find((x) => x.sku === it.sku);
    if (!v) { diffs.push({ ...it, ok: false, error: `Không tìm thấy biến thể ${it.sku}.` }); continue; }
    const counted = Number(it.counted ?? it.stock ?? 0);
    const before = v.stock;
    v.stock = counted;
    diffs.push({ productId: p.id, sku: v.sku, before, counted, diff: counted - (before === -1 ? 0 : before), ok: true });
  }
  const rec: StockRecordExt = { id: uid('aud'), shopKey: sk, quantity: 0, dir: 'audit', at: nowIso(), by: ctxAccountId(ctx) };
  E.stockRecords.push(rec);
  return ok({ audit: rec, diffs });
}

function hApplyStockTransfer(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const from = state.products.find((x) => x.id === String(args.fromProductId ?? ''));
  const to = state.products.find((x) => x.id === String(args.toProductId ?? args.fromProductId ?? ''));
  if (!from || !canAccess(ctx, from.shopKey)) return fail('Không tìm thấy sản phẩm nguồn.');
  if (!to || !canAccess(ctx, to.shopKey)) return fail('Không tìm thấy sản phẩm đích.');
  const fromV = from.variants.find((x) => x.sku === args.fromSku);
  const toV = to.variants.find((x) => x.sku === (args.toSku ?? args.fromSku));
  if (!fromV || !toV) return fail('Không tìm thấy biến thể nguồn/đích.');
  const qty = Number(args.quantity ?? 0);
  if (!(qty > 0)) return fail('Số lượng chuyển phải lớn hơn 0.');
  if (fromV.stock !== -1 && fromV.stock < qty) return fail(`Tồn kho nguồn chỉ còn ${fromV.stock}, không đủ chuyển ${qty}.`);
  if (fromV.stock !== -1) fromV.stock -= qty;
  toV.stock = toV.stock === -1 ? qty : toV.stock + qty;
  const rec: StockRecordExt = { id: uid('trf'), shopKey: from.shopKey, fromSku: fromV.sku, toSku: toV.sku, quantity: qty, dir: 'transfer', at: nowIso(), by: ctxAccountId(ctx) } as StockRecordExt;
  E.stockRecords.push(rec);
  return ok({ record: rec, fromVariant: fromV, toVariant: toV });
}

function hAdjustCostPrice(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const p = state.products.find((x) => x.id === String(args.productId ?? ''));
  if (!p || !canAccess(ctx, p.shopKey)) return fail('Không tìm thấy sản phẩm (hoặc sản phẩm không thuộc shop của bạn).');
  if (args.sku) {
    const v = p.variants.find((x) => x.sku === args.sku);
    if (!v) return fail(`Không tìm thấy biến thể SKU ${args.sku}.`);
    if (args.costPrice !== undefined) v.costPrice = Number(args.costPrice);
    return ok({ product: p, variant: v });
  }
  if (args.costPrice !== undefined) {
    for (const v of p.variants) v.costPrice = Number(args.costPrice);
  }
  return ok({ product: p });
}

// ---------------------------------------------------------------------------
// Handlers: tài khoản / shop / gói
// ---------------------------------------------------------------------------

function hCreateShopAccount(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk);
  if (!shop) return fail('Không tìm thấy shop.');
  const limits = shopLimits(state, shop);
  const staffUsed = state.accounts.filter((a) => a.shopKey === sk).length;
  if (staffUsed >= limits.staff) return fail(quotaError(state, 'staff', limits.staff));
  const email = String(args.email ?? '').trim().toLowerCase();
  const username = String(args.username ?? '').trim().toLowerCase();
  const password = String(args.password ?? '');
  if (!email || !username || password.length < 6) return fail('Cần email, tên đăng nhập và mật khẩu tối thiểu 6 ký tự.');
  if (state.accounts.some((a) => a.email.toLowerCase() === email || a.username.toLowerCase() === username)) {
    return fail('Email hoặc tên đăng nhập đã được dùng.');
  }
  const acc: Account = {
    id: uid('acc'),
    email,
    username,
    passwordHash: hashPassword(password),
    role: args.role === 'owner' || args.role === 'shop_owner' ? 'shop_owner' : 'staff',
    shopKey: sk,
    displayName: args.name,
    createdAt: nowIso(),
  };
  state.accounts.push(acc);
  return ok({ account: toPublicAccount(acc) });
}

function hUpdateShopAccount(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const acc = state.accounts.find((a) => a.id === String(args.accountId ?? args.id ?? ''));
  if (!acc || !canAccess(ctx, acc.shopKey)) return fail('Không tìm thấy tài khoản (hoặc tài khoản không thuộc shop của bạn).');
  if (args.name !== undefined) acc.displayName = args.name;
  if (args.role !== undefined && ctxIsSuperAdmin(ctx)) acc.role = args.role;
  if (args.password) {
    if (String(args.password).length < 6) return fail('Mật khẩu mới tối thiểu 6 ký tự.');
    acc.passwordHash = hashPassword(String(args.password));
  }
  return ok({ account: toPublicAccount(acc) });
}

function hDeleteShopAccount(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const idx = state.accounts.findIndex((a) => a.id === String(args.accountId ?? args.id ?? ''));
  if (idx < 0 || !canAccess(ctx, state.accounts[idx].shopKey)) return fail('Không tìm thấy tài khoản (hoặc tài khoản không thuộc shop của bạn).');
  if (state.accounts[idx].role === 'super_admin') return fail('Không xóa được tài khoản Super Admin.');
  const [deleted] = state.accounts.splice(idx, 1);
  return ok({ deletedId: deleted.id });
}

function hSaveShop(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const s = args.shop ?? args;
  const key = String(s.key ?? s.shopKey ?? ctxShopKey(ctx) ?? '');
  if (!key) return fail('Thiếu mã shop (shopKey).');
  if (!ctxIsSuperAdmin(ctx) && ctxShopKey(ctx) !== key) return fail('Chỉ được sửa shop của mình.');
  const existing = getShop(state, key);
  const plan = (s.plan ?? existing?.plan ?? 'dung-thu') as Shop['plan'];
  const planRow = state.saasConfig?.plans?.find((p) => p.key === plan);
  const shop: Shop = {
    key,
    name: String(s.name ?? existing?.name ?? key),
    domain: String(s.domain ?? existing?.domain ?? `${key}.achat.vn`),
    plan,
    pageLimit: Number(s.pageLimit ?? planRow?.pageLimit ?? existing?.pageLimit ?? 1),
    staffLimit: Number(s.staffLimit ?? planRow?.staffLimit ?? existing?.staffLimit ?? 1),
    trialEndsAt: s.trialEndsAt ?? existing?.trialEndsAt ?? null,
    status: (s.status ?? existing?.status ?? (plan === 'dung-thu' ? 'trial' : 'active')) as Shop['status'],
    createdAt: existing?.createdAt ?? nowIso(),
  };
  const e = shop as ShopExt;
  const old = existing as ShopExt | undefined;
  e.extraPages = s.extraPages ?? old?.extraPages ?? 0;
  e.extraStaff = s.extraStaff ?? old?.extraStaff ?? 0;
  if (old) {
    e.carrierConfigs = old.carrierConfigs;
    e.capiAccessToken = old.capiAccessToken;
    e.capiTestEventCode = old.capiTestEventCode;
    e.aiKeyHash = old.aiKeyHash;
    e.aiKeyMasked = old.aiKeyMasked;
    e.aiKeyCreatedAt = old.aiKeyCreatedAt;
    e.meta = old.meta;
    e.pickup = old.pickup;
    const idx = state.shops.findIndex((s) => s.key === key);
    state.shops[idx] = shop;
  } else {
    state.shops.push(shop);
    // Shop mới trống hoàn toàn: 0 quy tắc ship, CAPI chưa nối.
    state.shipFeeRulesByShop[key] = [];
    state.capiConfigByShop[key] = { shopKey: key, pixelId: '', connected: false };
  }
  void E;
  return ok({ shop: publicShop(state, shop) });
}

function hDeleteShop(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  const key = String(args.shopKey ?? args.key ?? '');
  const idx = state.shops.findIndex((s) => s.key === key);
  if (idx < 0) return fail('Không tìm thấy shop.');
  state.shops.splice(idx, 1);
  // Xóa cấu hình riêng của shop; đơn/sản phẩm cũ GIỮ LẠI để Super Admin tra cứu.
  state.fanpages = state.fanpages.filter((f) => f.shopKey !== key);
  delete state.shipFeeRulesByShop[key];
  delete state.capiConfigByShop[key];
  return ok({ deletedShopKey: key, note: 'Đã xóa shop + cấu hình riêng (page/CAPI/quy tắc ship). Đơn và sản phẩm cũ được giữ lại để tra cứu.' });
}

function hSaveShipFeeRules(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  if (!getShop(state, sk)) return fail('Không tìm thấy shop.');
  const rules = normalizeShipRules(args.rules ?? args.shipFeeRules, sk);
  if (!rules) return fail('Danh sách quy tắc phí ship trống hoặc sai định dạng.');
  state.shipFeeRulesByShop[sk] = rules;
  return ok({ shopKey: sk, shipFeeRules: rules });
}

function hSaveSaasConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  const cfg = args.config ?? args;
  state.saasConfig = {
    plans: Array.isArray(cfg.plans) ? cfg.plans : state.saasConfig.plans,
    extraPagePrice: cfg.extraPagePrice !== undefined ? Number(cfg.extraPagePrice) : state.saasConfig.extraPagePrice,
    extraStaffPrice: cfg.extraStaffPrice !== undefined ? Number(cfg.extraStaffPrice) : state.saasConfig.extraStaffPrice,
    hotline: cfg.hotline ?? state.saasConfig.hotline,
    mainDomain: cfg.mainDomain ?? state.saasConfig.mainDomain,
    trialDaysOptions: Array.isArray(cfg.trialDaysOptions) ? cfg.trialDaysOptions : state.saasConfig.trialDaysOptions,
  };
  return ok({ saasConfig: state.saasConfig });
}

function hSetupSuperAdmin(state: State, _ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  if (E.superAdminSetup || state.accounts.some((a) => a.role === 'super_admin')) {
    return fail('Super Admin đã được thiết lập rồi.');
  }
  const email = String(args.email ?? '').trim().toLowerCase();
  const password = String(args.password ?? '');
  if (!email || password.length < 6) return fail('Cần email và mật khẩu Super Admin tối thiểu 6 ký tự.');
  if (state.accounts.some((a) => a.email.toLowerCase() === email)) return fail('Email đã được dùng.');
  const acc: Account = {
    id: uid('acc'),
    email,
    username: String(args.username ?? 'superadmin').toLowerCase(),
    passwordHash: hashPassword(password),
    role: 'super_admin',
    shopKey: null,
    displayName: args.name ?? 'Super Admin',
    createdAt: nowIso(),
  };
  state.accounts.push(acc);
  E.superAdminSetup = true;
  return ok({ account: toPublicAccount(acc) });
}

// ---------------------------------------------------------------------------
// Handlers: vận chuyển
// ---------------------------------------------------------------------------

function hSaveCarrierConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const carrier = String(args.carrier ?? '') as CarrierCode;
  if (!['GHN', 'GHTK', 'VTP', 'BEST', 'JT'].includes(carrier)) return fail('Hãng vận chuyển không hợp lệ (GHN/GHTK/VTP/BEST/JT).');
  const cfg: CarrierConfig = { ...(args.config ?? args), carrier };
  delete (cfg as unknown as Record<string, unknown>).shopKey;
  shop.carrierConfigs = { ...(shop.carrierConfigs ?? {}), [carrier]: cfg };
  return ok({ shopKey: sk, carrier, config: (publicShop(state, shop).carrierConfigs as Record<string, unknown> | undefined)?.[carrier] ?? cfg });
}

async function hTestCarrierConnection(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const carrier = String(args.carrier ?? '') as CarrierCode;
  const cfg = getCarrierConfig(state, sk, carrier) ?? ({ carrier, ...(args.config ?? {}) } as CarrierConfig);
  const r = await testCarrierConnection(cfg);
  if (!r.ok) return fail(r.error ?? 'Kiểm tra kết nối thất bại.');
  return ok({ carrier, message: r.statusText ?? 'Kết nối OK.', fee: r.fee });
}

async function hQuoteCarrierFee(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const carrier = normalizeCarrierCode(args.carrier);
  // J&T: trả UNSUPPORTED_PUSH rõ ràng ngay cả khi chưa nhập cấu hình.
  if (carrier === 'JT') {
    const r = await quoteCarrierFee({ carrier: 'JT' } as CarrierConfig, {
      toProvince: '', toDistrict: '', weightGrams: GRAMS_PER_PAIR, codAmount: 0,
    });
    return fail(r.error ?? 'J&T chưa được kết nối thật. Mã lỗi: UNSUPPORTED_PUSH.');
  }
  const cfg = getCarrierConfig(state, sk, carrier);
  if (!cfg) return fail(`Chưa kết nối ${carrier}. Vào Cài đặt vận chuyển để nhập thông tin kết nối.`);
  const r = await quoteCarrierFee(cfg, {
    toProvince: args.toProvince ?? args.province ?? '',
    toDistrict: args.toDistrict ?? args.district ?? '',
    toWard: args.toWard ?? args.ward,
    toDistrictId: args.toDistrictId,
    toWardCode: args.toWardCode,
    weightGrams: Number(args.weightGrams ?? args.weight ?? GRAMS_PER_PAIR),
    codAmount: Number(args.codAmount ?? args.value ?? 0),
    serviceId: args.serviceId,
  });
  if (!r.ok) return fail(r.error ?? 'Không tính được phí.');
  return ok({ carrier, fee: r.fee });
}

/** Chuẩn hóa mã hãng: J&T có nhiều cách viết (JNT/J&T/JT) — đều về 'JT'. */
function normalizeCarrierCode(raw: unknown): CarrierCode {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (c === 'JNT' || c === 'JT') return 'JT';
  return String(raw ?? '').toUpperCase() as CarrierCode;
}

async function hPushOrdersToCarrier(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const carrier = normalizeCarrierCode(args.carrier);
  const ids: string[] = Array.isArray(args.orderIds) ? args.orderIds : args.orderId ? [String(args.orderId)] : [];
  if (ids.length === 0) return fail('Chưa chọn đơn nào để đẩy.');
  // J&T: chưa nối thật nên trả UNSUPPORTED_PUSH rõ ràng ngay cả khi shop
  // chưa nhập cấu hình (không để rơi xuống lỗi "chưa kết nối").
  if (carrier === 'JT') {
    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const order = findOrder(state, ctx, id);
      if (!order) { results.push({ orderId: id, ok: false, error: 'Không tìm thấy đơn.' }); continue; }
      const r = await pushOrderToCarrier({ carrier: 'JT' } as CarrierConfig, orderToShipInput(order));
      results.push({ orderId: id, code: order.code, ok: false, error: r.error, rawCode: r.rawCode ?? 'UNSUPPORTED_PUSH', needsRepush: false });
    }
    return ok({ carrier, results, succeeded: 0, failed: results.length });
  }
  const cfg = getCarrierConfig(state, sk, carrier);
  if (!cfg) return fail(`Chưa kết nối ${carrier}. Vào Cài đặt vận chuyển để nhập thông tin kết nối.`);
  const results: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const order = findOrder(state, ctx, id);
    if (!order) { results.push({ orderId: id, ok: false, error: 'Không tìm thấy đơn.' }); continue; }
    // CHỈ lưu mã vận đơn hãng trả về; không tự sinh mã giả, không đổi trạng thái đơn ở đây.
    const r = await pushOrderToCarrier(cfg, orderToShipInput(order, { bestResendSeq: args.bestResendSeq }));
    if (!r.ok) {
      results.push({ orderId: id, code: order.code, ok: false, error: r.error, rawCode: r.rawCode, needsRepush: r.needsRepush ?? false });
      continue;
    }
    const e = order as OrderExt;
    order.carrier = carrier;
    order.waybillCode = r.waybillCode ?? '';
    e.shipHistory = [...(e.shipHistory ?? []), { at: nowIso(), carrier, waybillCode: r.waybillCode, fee: r.fee, by: ctxAccountId(ctx) }];
    order.updatedAt = nowIso();
    results.push({ orderId: id, code: order.code, ok: true, waybillCode: r.waybillCode, fee: r.fee });
  }
  return ok({ carrier, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}

function hPrecheckBulkShip(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const ids: string[] = Array.isArray(args.orderIds) ? args.orderIds : [];
  if (ids.length === 0) return fail('Chưa chọn đơn nào.');
  const results = ids.map((id) => {
    const order = findOrder(state, ctx, id);
    if (!order) return { orderId: id, ok: false, errors: ['Không tìm thấy đơn.'] };
    const e = order as OrderExt;
    const errors: string[] = [];
    if (!order.customerName) errors.push('Thiếu tên người nhận.');
    if (!order.customerPhone || !/(?<!\d)0\d{8,9}(?!\d)/.test(order.customerPhone)) errors.push('Thiếu/sai SĐT người nhận.');
    if (!order.customerAddress) errors.push('Thiếu địa chỉ.');
    if (!e.province || !e.district) errors.push('Thiếu tỉnh/huyện.');
    if (order.carrier === 'GHN' && !e.toDistrictId) errors.push('Thiếu mã quận/huyện GHN (toDistrictId).');
    if (order.remainingCod <= 0) errors.push('COD phải lớn hơn 0.');
    const pairs = order.items.reduce((s, l) => s + l.quantity, 0);
    if (pairs * GRAMS_PER_PAIR <= 0) errors.push('Thiếu cân nặng (số đôi = 0).');
    return { orderId: id, code: order.code, ok: errors.length === 0, errors };
  });
  return ok({ results, allOk: results.every((r) => r.ok) });
}

async function hCancelWaybill(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  const waybillCode = String(args.waybillCode ?? order?.waybillCode ?? '');
  const carrier = String(args.carrier ?? order?.carrier ?? '') as CarrierCode;
  if (!waybillCode || !carrier) return fail('Thiếu mã vận đơn hoặc hãng để hủy.');
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const cfg = getCarrierConfig(state, order?.shopKey ?? sk, carrier);
  if (!cfg) return fail(`Chưa kết nối ${carrier}.`);
  const r: CarrierResult = await cancelWaybill(cfg, waybillCode);
  if (!r.ok) return fail(r.error ?? 'Hủy vận đơn thất bại.');
  if (order) {
    const e = order as OrderExt;
    e.shipHistory = [...(e.shipHistory ?? []), { at: nowIso(), carrier, waybillCode, action: 'cancel', by: ctxAccountId(ctx) }];
    order.updatedAt = nowIso();
  }
  return ok({ waybillCode, carrier, needsRepush: r.needsRepush ?? false });
}

async function hTrackWaybill(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  const waybillCode = String(args.waybillCode ?? order?.waybillCode ?? '');
  const carrier = String(args.carrier ?? order?.carrier ?? '') as CarrierCode;
  if (!waybillCode || !carrier) return fail('Thiếu mã vận đơn hoặc hãng để tra cứu.');
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const cfg = getCarrierConfig(state, order?.shopKey ?? sk, carrier);
  if (!cfg) return fail(`Chưa kết nối ${carrier}.`);
  const r = await trackWaybill(cfg, waybillCode);
  if (!r.ok) return fail(r.error ?? 'Tra cứu thất bại.');
  if (order) {
    const e = order as OrderExt;
    e.shipHistory = [...(e.shipHistory ?? []), { at: nowIso(), carrier, waybillCode, action: 'track', status: r.status, statusText: r.statusText }];
  }
  return ok({ waybillCode, carrier, status: r.status, statusText: r.statusText, fee: r.fee, history: r.history ?? [] });
}

async function hRefreshWaybillStatus(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const ids: string[] = Array.isArray(args.orderIds) ? args.orderIds : args.orderId ? [String(args.orderId)] : [];
  const targets = ids.length > 0
    ? ids.map((id) => findOrder(state, ctx, id)).filter((o): o is Order => !!o && !!o.waybillCode)
    : state.orders.filter((o) => canAccess(ctx, o.shopKey) && o.waybillCode && o.carrier);
  const results: Array<Record<string, unknown>> = [];
  for (const order of targets) {
    const r = await hTrackWaybill(state, ctx, { orderId: order.code });
    results.push({ orderId: (order as OrderExt).id, code: order.code, waybillCode: order.waybillCode, ...r });
  }
  return ok({ results, refreshed: results.filter((r) => r.ok).length });
}

async function hPrintCarrierWaybill(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order || !order.waybillCode || !order.carrier) return fail('Đơn chưa có mã vận đơn để in.');
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const cfg = getCarrierConfig(state, order.shopKey, order.carrier as CarrierCode);
  if (!cfg) return fail(`Chưa kết nối ${order.carrier}.`);
  if (order.carrier === 'GHN') {
    // In A5 GHN: POST /a5/gen-token lấy token rồi mở link in.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch('https://online-gateway.ghn.vn/a5/gen-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Token: cfg.token ?? '' },
        body: JSON.stringify({ order_codes: [order.waybillCode] }),
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (!res.ok || body?.code !== 200 || !body?.data?.token) {
        return fail(`GHN báo lỗi lấy token in: ${body?.message ?? 'lỗi không rõ'}.`);
      }
      return ok({ waybillCode: order.waybillCode, carrier: 'GHN', printUrl: `https://online-gateway.ghn.vn/a5/print?token=${body.data.token}` });
    } finally {
      clearTimeout(t);
    }
  }
  if (order.carrier === 'GHTK') {
    return ok({ waybillCode: order.waybillCode, carrier: 'GHTK', printUrl: `https://services.giaohangtietkiem.vn/services/label/${order.waybillCode}` });
  }
  return fail(`Chưa hỗ trợ in nhãn ${order.carrier} trong bản standalone (GHN/GHTK đã có).`);
}

function hAttachWaybillToOrder(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng.');
  const waybillCode = String(args.waybillCode ?? '');
  const carrier = String(args.carrier ?? '') as CarrierCode;
  if (!waybillCode || !['GHN', 'GHTK', 'VTP', 'BEST', 'JT'].includes(carrier)) return fail('Thiếu mã vận đơn hoặc hãng không hợp lệ.');
  order.carrier = carrier;
  order.waybillCode = waybillCode;
  const e = order as OrderExt;
  e.shipHistory = [...(e.shipHistory ?? []), { at: nowIso(), carrier, waybillCode, action: 'attach-manual', by: ctxAccountId(ctx) }];
  order.updatedAt = nowIso();
  return ok({ order });
}

async function hCheckContractFees(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const carrier = String(args.carrier ?? '') as CarrierCode;
  const cfg = getCarrierConfig(state, sk, carrier);
  if (!cfg) return fail(`Chưa kết nối ${carrier}.`);
  const contractFee = Number((cfg as unknown as Record<string, unknown>).contractFee ?? (carrier === 'BEST' ? BEST_CONTRACT_FEE : 0));
  if (carrier === 'BEST') {
    return ok({ carrier, contractFee: BEST_CONTRACT_FEE, quotedFee: BEST_CONTRACT_FEE, match: contractFee === BEST_CONTRACT_FEE, note: 'Best tính theo giá hợp đồng 12.000đ/đơn.' });
  }
  const q = await quoteCarrierFee(cfg, {
    toProvince: args.toProvince ?? cfg.pickupProvince ?? '',
    toDistrict: args.toDistrict ?? cfg.pickupDistrict ?? '',
    weightGrams: Number(args.weightGrams ?? GRAMS_PER_PAIR),
    codAmount: Number(args.codAmount ?? 0),
    toDistrictId: args.toDistrictId,
    toWardCode: args.toWardCode,
  });
  if (!q.ok) return fail(q.error ?? 'Không tính được phí để đối chiếu.');
  return ok({ carrier, contractFee, quotedFee: q.fee, match: contractFee === 0 ? true : contractFee === q.fee });
}

// ---------------------------------------------------------------------------
// Handlers: CAPI / Pixel
// ---------------------------------------------------------------------------

function hSaveCapiConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const cfg = args.config ?? args;
  const pixelId = String(cfg.pixelId ?? state.capiConfigByShop[sk]?.pixelId ?? '');
  if (cfg.accessToken) shop.capiAccessToken = String(cfg.accessToken);
  if (cfg.testEventCode !== undefined) shop.capiTestEventCode = String(cfg.testEventCode);
  state.capiConfigByShop[sk] = {
    shopKey: sk,
    pixelId,
    connected: Boolean(pixelId && shop.capiAccessToken),
  };
  return ok({ shopKey: sk, capi: getCapiConfig(shopCapiLibConfig(state, sk)) });
}

function hGetCapiConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  if (!getShop(state, sk)) return fail('Không tìm thấy shop.');
  return ok({ shopKey: sk, capi: getCapiConfig(shopCapiLibConfig(state, sk)) });
}

function hSaveShopCapiPixel(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  if (!args.pixelId) return fail('Thiếu Pixel ID.');
  state.capiConfigByShop[sk] = {
    shopKey: sk,
    pixelId: String(args.pixelId),
    connected: Boolean(shop.capiAccessToken),
  };
  return ok({ shopKey: sk, capi: getCapiConfig(shopCapiLibConfig(state, sk)) });
}

function hDisconnectShopCapiPixel(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  if (!getShop(state, sk)) return fail('Không tìm thấy shop.');
  state.capiConfigByShop[sk] = { shopKey: sk, pixelId: '', connected: false };
  return ok({ shopKey: sk, disconnected: true });
}

async function hListShopMetaPixels(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  const token = String(args.userAccessToken ?? shop?.meta?.userAccessToken ?? '');
  if (!token) return fail('Thiếu user access token. Chủ shop đăng nhập lại qua "Kết nối tài khoản Meta".');
  const r = await listShopPixels(token);
  if (!r.ok) return fail(r.error ?? 'Không liệt kê được Pixel.');
  return ok({ shopKey: sk, pixels: r.data });
}

async function hResendCapiPurchase(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const order = findOrder(state, ctx, String(args.orderId ?? args.id ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng.');
  const capiCfg = shopCapiLibConfig(state, order.shopKey);
  if (!capiCfg.pixelId || !capiCfg.accessToken) return fail('Shop chưa kết nối Pixel (thiếu Pixel ID hoặc Conversions API token).');
  const r = await resendPurchaseEvent({
    pixelId: capiCfg.pixelId,
    accessToken: capiCfg.accessToken,
    orderCode: order.code,
    phone: order.customerPhone,
    name: order.customerName,
    value: order.remainingCod,
    skus: order.items.map((l) => l.sku).filter(Boolean),
    testEventCode: capiCfg.testEventCode,
  });
  order.capiStatus = mapLibCapiStatus(r.status);
  order.capiLog = r.message;
  order.updatedAt = nowIso();
  if (!r.ok) return fail(r.message);
  return ok({ order, capiStatus: r.status, message: r.message });
}

async function hSendCapiTestEvent(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const capiCfg = shopCapiLibConfig(state, sk);
  if (!capiCfg.pixelId || !capiCfg.accessToken) return fail('Shop chưa kết nối Pixel (thiếu Pixel ID hoặc Conversions API token).');
  const testEventCode = String(args.testEventCode ?? capiCfg.testEventCode ?? '');
  if (!testEventCode) return fail('Thiếu test_event_code. Lấy mã trong Events Manager > Test Events.');
  const r = await sendTestEvent({ pixelId: capiCfg.pixelId, accessToken: capiCfg.accessToken, testEventCode, value: Number(args.value ?? 0) });
  if (!r.ok) return fail(r.message);
  return ok({ message: r.message });
}

// ---------------------------------------------------------------------------
// Handlers: khóa AI theo SHOP + trợ lý AI (rule-engine) + train chat
// ---------------------------------------------------------------------------

function hSetShopAiKey(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const key = String(args.apiKey ?? args.key ?? '');
  if (key.length < 10) return fail('Khóa AI không hợp lệ.');
  shop.aiKeyHash = sha256hex(key);
  shop.aiKeyMasked = maskSecret(key);
  shop.aiKeyCreatedAt = nowIso();
  return ok({ shopKey: sk, hasAiKey: true, masked: shop.aiKeyMasked });
}

function hCheckShopAiKey(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  return ok({ shopKey: sk, hasAiKey: Boolean(shop?.aiKeyHash), masked: shop?.aiKeyMasked ?? null });
}

function hGenerateClaudeApiKey(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  if (shop.aiKeyHash && args.confirm !== true) {
    return fail('Shop đã có khóa AI. Gọi lại với confirm:true để thay khóa cũ (khóa cũ sẽ hết hiệu lực).');
  }
  // Sinh sk- + 48 ký tự hex (24 bytes). Hiện đầy đủ DUY NHẤT 1 lần này.
  const key = 'sk-' + crypto.randomBytes(24).toString('hex');
  shop.aiKeyHash = sha256hex(key);
  shop.aiKeyMasked = maskSecret(key);
  shop.aiKeyCreatedAt = nowIso();
  return ok({ shopKey: sk, apiKey: key, masked: shop.aiKeyMasked, note: 'Khóa chỉ hiện đầy đủ 1 lần này. Lưu lại ngay, lần sau chỉ xem được dạng đã che.' });
}

function hRevealClaudeApiKey(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  // Khóa chỉ lưu dạng băm nên không khôi phục được giá trị gốc — chỉ trả dạng che.
  return ok({ shopKey: sk, hasAiKey: Boolean(shop?.aiKeyHash), masked: shop?.aiKeyMasked ?? null, note: 'Khóa đã lưu dạng băm, không xem lại được toàn bộ. Cần khóa mới thì dùng generateclaudeapikey.' });
}

function hVerifyClaudeApiKey(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  const key = String(args.apiKey ?? args.key ?? '');
  if (!/^sk-[0-9a-f]{48}$/.test(key)) return fail('Khóa không đúng định dạng sk- + 48 ký tự hex.');
  if (!shop?.aiKeyHash) return fail('Shop chưa có khóa AI để đối chiếu.');
  if (sha256hex(key) !== shop.aiKeyHash) return fail('Khóa không khớp với khóa đã lưu của shop.');
  return ok({ shopKey: sk, valid: true });
}

function hGetClaudeConnection(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  return ok({ shopKey: sk, hasAiKey: Boolean(shop?.aiKeyHash), masked: shop?.aiKeyMasked ?? null, createdAt: shop?.aiKeyCreatedAt ?? null });
}

function hAssistantChat(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const text = String(args.message ?? args.text ?? '');
  if (!text) return fail('Thiếu nội dung chat.');
  const intent = classifyIntent(text);
  const shop = getShop(state, sk) as ShopExt | undefined;
  // Hành động đẩy/xóa đơn PHẢI hỏi xác nhận trước, không tự chạy.
  if ((intent === 'day_don' || intent === 'xoa_don') && args.confirm !== true) {
    const what = intent === 'day_don' ? 'đẩy đơn qua hãng vận chuyển' : 'xóa đơn';
    return ok({
      intent,
      needsConfirm: true,
      reply: `Chị xác nhận ${what} này giúp em nhé? Em sẽ làm ngay sau khi chị xác nhận.`,
      draftAction: intent,
    });
  }
  const r = ruleEngineReply(state, sk, text);
  const note = shop?.aiKeyHash
    ? 'Trả lời bằng rule-engine theo bảng giá + quy tắc AI đã dạy của shop.'
    : 'Shop chưa có khóa AI — trả lời bằng rule-engine (khớp từ khóa + bảng giá + quy tắc đã dạy). Thêm khóa AI trong Cài đặt để bật trợ lý đầy đủ.';
  return ok({ intent: r.intent, reply: r.reply, matchedRule: r.matchedRule, note });
}

function hAiChat(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  return hAssistantChat(state, ctx, args);
}

function hTrainChat(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const question = String(args.question ?? args.q ?? '');
  const answer = String(args.answer ?? args.a ?? '');
  if (!question || !answer) return fail('Cần câu hỏi và câu trả lời để dạy AI.');
  const item: TrainChatExt = { id: uid('trn'), shopKey: sk, question, answer, status: 'pending', at: nowIso(), by: ctxAccountId(ctx) };
  E.trainChats.push(item);
  return ok({ trainChat: item, note: 'Đã ghi lại để chờ duyệt (confirmtrainrule) rồi mới thành quy tắc AI chính thức.' });
}

function hConfirmTrainRule(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const id = String(args.trainChatId ?? args.id ?? '');
  const tc = E.trainChats.find((t) => t.id === id);
  if (!tc || !canAccess(ctx, tc.shopKey)) return fail('Không tìm thấy bản dạy AI chờ duyệt.');
  const rule: AiRule = {
    id: uid('air'),
    shopKey: tc.shopKey,
    name: tc.question.slice(0, 80),
    keywords: tc.question.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 8),
    reply: tc.answer,
    enabled: true,
  };
  state.aiRules.push(rule);
  tc.status = 'confirmed';
  tc.ruleId = rule.id;
  return ok({ rule });
}

function hGetTrainChat(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  return ok({ shopKey: sk, items: E.trainChats.filter((t) => t.shopKey === sk) });
}

function hClearTrainChat(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const status = args.status as string | undefined;
  const before = E.trainChats.length;
  E.trainChats = E.trainChats.filter((t) => !(t.shopKey === sk && (!status || t.status === status)));
  return ok({ shopKey: sk, cleared: before - E.trainChats.length });
}

function hSaveAiRule(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const r = args.rule ?? args;
  if (!r.reply && !r.answer) return fail('Quy tắc AI thiếu câu trả lời.');
  const id = String(r.id ?? uid('air'));
  const rule: AiRule = {
    id,
    shopKey: sk,
    name: String(r.name ?? r.question ?? id),
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    reply: String(r.reply ?? r.answer),
    enabled: r.enabled !== false,
  };
  const idx = state.aiRules.findIndex((x) => x.id === id);
  if (idx >= 0) state.aiRules[idx] = rule;
  else state.aiRules.push(rule);
  return ok({ rule });
}

function hDeleteAiRule(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const id = String(args.ruleId ?? args.id ?? '');
  const idx = state.aiRules.findIndex((r) => r.id === id);
  if (idx < 0 || !canAccess(ctx, state.aiRules[idx].shopKey)) return fail('Không tìm thấy quy tắc AI.');
  state.aiRules.splice(idx, 1);
  return ok({ deletedId: id });
}

function hAiExtractOrder(_state: State, _ctx: ActionContext, args: Record<string, any>): ActionResult {
  const text = String(args.text ?? args.message ?? '');
  if (!text) return fail('Thiếu nội dung tin nhắn để tách đơn.');
  const ext = extractOrderFromText(text);
  return ok({ draft: { lines: ext.lines, phone: ext.phone }, note: 'Tách bằng regex (size/màu/SĐT). Kiểm tra lại trước khi lên đơn.' });
}

function hAiGenerateContent(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const kind = String(args.kind ?? 'product-post');
  const p = state.products.find((x) => x.id === String(args.productId ?? ''));
  if (kind === 'product-post' && p) {
    const price = p.price.toLocaleString('vi-VN');
    const colors = [...new Set(p.variants.map((v) => v.color).filter(Boolean))].join(', ');
    return ok({
      content: `🔥 ${p.name} — chỉ ${price}đ/đôi, 2 đôi 99k miễn ship!\n${colors ? `Màu: ${colors}. ` : ''}Được kiểm tra hàng trước khi thanh toán ạ. Inbox ngay để chốt đơn nha!`,
      note: 'Nội dung mẫu tạo từ thông tin sản phẩm thật (không bịa giá/ưu đãi).',
    });
  }
  return ok({ content: '', note: 'Chưa đủ dữ liệu sản phẩm để tạo nội dung.' });
}

function hAiProposeRule(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const rule: AiRule = {
    id: uid('air'),
    shopKey: sk,
    name: String(args.name ?? args.question ?? 'Quy tắc đề xuất'),
    keywords: Array.isArray(args.keywords) ? args.keywords : [],
    reply: String(args.reply ?? args.answer ?? ''),
    enabled: false,
  };
  state.aiRules.push(rule);
  return ok({ rule, note: 'Quy tắc đang ở trạng thái nháp (chưa bật) — duyệt rồi mới áp dụng.' });
}

function hAiSuggestNote(_state: State, _ctx: ActionContext, args: Record<string, any>): ActionResult {
  const text = String(args.text ?? args.message ?? '');
  const lines: OrderItem[] = Array.isArray(args.lines) ? args.lines : Array.isArray(args.items) ? args.items : [];
  let note = '';
  if (lines.length > 0) {
    note = `Khách đặt: ${lines.map((l) => `${l.quantity} đôi ${l.size ? 'size ' + l.size + ' ' : ''}${l.color ? l.color + ' ' : ''}${l.sku || ''}`.trim()).join(' + ')}`;
  } else if (text) {
    note = `Khách đặt: ${text.trim().slice(0, 200)}`;
  }
  if (!note) return fail('Thiếu nội dung để gợi ý ghi chú.');
  return ok({ note });
}

function hAiAnalyzeReview(_state: State, _ctx: ActionContext, args: Record<string, any>): ActionResult {
  const text = String(args.text ?? args.review ?? '').toLowerCase();
  if (!text) return fail('Thiếu nội dung đánh giá.');
  const pos = ['đẹp', 'êm', 'tốt', 'thích', 'ưng', 'nhẹ', 'xinh', 'tuyệt', 'ok', 'hài lòng'];
  const neg = ['xấu', 'đau', 'rách', 'hỏng', 'lừa', 'tệ', 'chật', 'rộng', 'không vừa', 'thất vọng', 'kém'];
  let score = 0;
  const hitsPos: string[] = [];
  const hitsNeg: string[] = [];
  for (const w of pos) if (text.includes(w)) { score++; hitsPos.push(w); }
  for (const w of neg) if (text.includes(w)) { score--; hitsNeg.push(w); }
  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  return ok({ sentiment, score, hitsPos, hitsNeg, note: 'Phân tích bằng từ khóa tiếng Việt (không dùng LLM).' });
}

// ---------------------------------------------------------------------------
// Handlers: sổ quỹ / công nợ / trả hàng / điểm thưởng
// ---------------------------------------------------------------------------

function hCreateCashEntry(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const amount = Number(args.amount ?? 0);
  const kind = String(args.type ?? args.kind ?? '');
  const mapped: CashEntry['kind'] | undefined = kind === 'in' || kind === 'thu' ? 'thu' : kind === 'out' || kind === 'chi' ? 'chi' : undefined;
  if (!amount || !mapped) return fail('Cần số tiền và loại thu/chi (in/out).');
  const entry: CashEntry = { id: uid('csh'), shopKey: sk, kind: mapped, amount, note: String(args.note ?? ''), createdAt: nowIso() };
  state.cashEntries.push(entry);
  return ok({ entry });
}

function hPaySupplierDebt(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const debt = E.supplierDebts.find((d) => d.id === String(args.debtId ?? args.id ?? ''));
  if (!debt || !canAccess(ctx, debt.shopKey)) return fail('Không tìm thấy khoản nợ nhà cung cấp.');
  const amount = Number(args.amount ?? 0);
  if (!(amount > 0)) return fail('Số tiền trả phải lớn hơn 0.');
  if (amount > Number(debt.remaining ?? 0)) return fail(`Số tiền trả vượt số nợ còn lại (${debt.remaining}).`);
  debt.remaining = Number(debt.remaining ?? 0) - amount;
  debt.paid = Number(debt.paid ?? 0) + amount;
  debt.status = debt.remaining <= 0 ? 'paid' : 'partial';
  const entry: CashEntry = { id: uid('csh'), shopKey: sk, kind: 'chi', amount, note: `Trả nợ NCC ${debt.supplierName ?? debt.id}`, createdAt: nowIso() };
  state.cashEntries.push(entry);
  return ok({ debt, cashEntry: entry });
}

function hCreateReturnSlip(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const order = findOrder(state, ctx, String(args.orderId ?? args.code ?? ''));
  if (!order) return fail('Không tìm thấy đơn hàng để tạo phiếu trả.');
  const slip: ReturnSlipExt = {
    id: uid('ret'),
    shopKey: order.shopKey,
    orderId: (order as OrderExt).id,
    orderCode: order.code,
    reason: String(args.reason ?? ''),
    items: Array.isArray(args.items) ? args.items : order.items,
    status: 1,
    at: nowIso(),
    by: ctxAccountId(ctx),
  };
  E.returnSlips.push(slip);
  return ok({ returnSlip: slip });
}

function hAdvanceReturnSlip(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const slip = E.returnSlips.find((s) => s.id === String(args.returnSlipId ?? args.id ?? ''));
  if (!slip || !canAccess(ctx, slip.shopKey)) return fail('Không tìm thấy phiếu trả hàng.');
  const step = Number(args.step ?? (Number(slip.status ?? 1) + 1));
  if (!Number.isInteger(step) || step < 1 || step > 5) return fail('Bước phiếu trả phải từ 1 đến 5.');
  slip.status = step;
  slip.updatedAt = nowIso();
  return ok({ returnSlip: slip });
}

function hConfirmCarrierReturnReceived(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const slip = E.returnSlips.find((s) => s.id === String(args.returnSlipId ?? args.id ?? ''));
  if (!slip || !canAccess(ctx, slip.shopKey)) return fail('Không tìm thấy phiếu trả hàng.');
  slip.carrierReturnReceived = true;
  slip.carrierReturnReceivedAt = nowIso();
  slip.status = 5;
  return ok({ returnSlip: slip });
}

function hRedeemPointsForCoupon(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const customerId = String(args.customerId ?? args.phone ?? '');
  const cust = state.customers.find((c) => (c.id === customerId || c.phone === customerId) && c.shopKey === sk);
  if (!cust) return fail('Không tìm thấy khách hàng.');
  const points = Number(args.points ?? 0);
  if (!(points > 0)) return fail('Số điểm đổi phải lớn hơn 0.');
  if (cust.loyaltyPoints < points) return fail(`Khách chỉ còn ${cust.loyaltyPoints} điểm, không đủ đổi ${points} điểm.`);
  cust.loyaltyPoints -= points;
  const value = points * (state.loyaltyConfig?.pointValueVnd ?? 500);
  const coupon = { id: uid('cpn'), shopKey: sk, code: `LOYAL-${Date.now().toString(36).toUpperCase()}`, amount: value, isPercent: false, enabled: true };
  state.coupons.push(coupon);
  const rec = E.loyalty[customerId] ?? { customerId, shopKey: sk, points: 0, coupons: [] };
  rec.coupons = [...(rec.coupons ?? []), { code: coupon.code, pointsUsed: points, value, at: nowIso() }];
  E.loyalty[customerId] = rec;
  return ok({ customerId, pointsLeft: cust.loyaltyPoints, coupon });
}

function hAdjustLoyaltyPoints(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const customerId = String(args.customerId ?? args.phone ?? '');
  if (!customerId) return fail('Thiếu mã/SĐT khách hàng.');
  const cust = state.customers.find((c) => (c.id === customerId || c.phone === customerId) && c.shopKey === sk);
  if (!cust) return fail('Không tìm thấy khách hàng trong shop.');
  const delta = Number(args.delta ?? args.points ?? 0);
  cust.loyaltyPoints = Math.max(0, cust.loyaltyPoints + delta);
  return ok({ customer: cust });
}

function hSaveLoyaltyConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const cfg = args.config ?? args;
  state.loyaltyConfig = {
    vndPerPoint: cfg.vndPerPoint !== undefined ? Number(cfg.vndPerPoint) : state.loyaltyConfig.vndPerPoint,
    pointValueVnd: cfg.pointValueVnd !== undefined ? Number(cfg.pointValueVnd) : state.loyaltyConfig.pointValueVnd,
    tiers: Array.isArray(cfg.tiers) ? cfg.tiers : state.loyaltyConfig.tiers,
  };
  void sk;
  return ok({ loyaltyConfig: state.loyaltyConfig });
}

// ---------------------------------------------------------------------------
// Handlers: seed / cách ly / migrate / records / singletons
// ---------------------------------------------------------------------------

function hSeedInitialData(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  if (!getShop(state, sk)) return fail('Không tìm thấy shop.');
  if (!state.shipFeeRulesByShop[sk] || state.shipFeeRulesByShop[sk].length === 0) {
    state.shipFeeRulesByShop[sk] = [
      { id: uid('rule'), name: 'Mặc định 1 SP ship 30k', scope: 'all', groupName: null, productId: null, minQty: 1, maxQty: 1, fee: 30000, enabled: true },
      { id: uid('rule'), name: 'Mặc định từ 2 SP miễn ship', scope: 'all', groupName: null, productId: null, minQty: 2, maxQty: null, fee: 0, enabled: true },
    ];
  }
  if (!E.careSettings[sk]) E.careSettings[sk] = { nudgeAfterMinutes: 5, enabled: true };
  if (!E.inviteSettings[sk]) E.inviteSettings[sk] = { enabled: true };
  void args;
  return ok({ shopKey: sk, seeded: true, note: 'Đã tạo quy tắc ship mặc định (30k/đơn, miễn ship từ 2 đôi) + cài đặt chăm sóc/mời.' });
}

function hSeedSampleOrders(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk);
  if (!shop) return fail('Không tìm thấy shop.');
  const existing = shopOrders(state, sk).filter((o) => (o as OrderExt).sample);
  if (existing.length > 0 && args.force !== true) return fail('Shop đã có đơn mẫu. Gọi lại với force:true để tạo thêm.');
  const created: Order[] = [];
  const samples: Array<{ name: string; phone: string; items: OrderItem[] }> = [
    { name: 'Khách mẫu 1', phone: '0900000001', items: [{ productId: '', sku: '', color: 'Đen', size: '37', quantity: 2, price: 50000 }] },
    { name: 'Khách mẫu 2', phone: '0900000002', items: [{ productId: '', sku: '', color: 'Kem', size: '36', quantity: 1, price: 50000 }] },
  ];
  for (const s of samples) {
    const totals = computeOrderTotals(state, sk, s.items, {});
    const code = nextOrderCode(state);
    const now = nowIso();
    const order = {
      id: uid('ord'),
      code, shopKey: sk, customerName: s.name, customerPhone: s.phone,
      customerAddress: 'Địa chỉ mẫu', province: 'Hà Nội', district: 'Quận Hai Bà Trưng',
      items: s.items, goodsTotal: totals.goodsTotal, shippingFee: totals.shippingFee,
      discountAmount: 0, totalAmount: totals.totalAmount, remainingCod: totals.remainingCod,
      orderStatus: 'cho_duyet' as OrderStatus, carrier: '', waybillCode: '',
      note: 'Khách đặt: đơn mẫu', source: 'sample', sample: true,
      capiStatus: 'chua_gui' as OrderCapiStatus, capiLog: '',
      history: [{ time: now, action: 'create', note: 'Tạo đơn mẫu', by: ctxAccountId(ctx) }],
      createdAt: now, updatedAt: now,
    } satisfies OrderExt;
    state.orders.push(order);
    created.push(order);
  }
  return ok({ orders: created });
}

function hSeedQuickReplyTemplates(state: State, ctx: ActionContext, _args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, _args);
  if (typeof sk !== 'string') return sk;
  const templates = [
    { title: 'Chào khách', text: 'Dạ em chào chị ạ! Shop em có dép quai ngang siêu êm, 2 đôi 99k miễn ship ạ.' },
    { title: 'Xin SĐT + địa chỉ', text: 'Dạ chị cho em xin SĐT và địa chỉ (ghi theo địa chỉ cũ trước sáp nhập) để em lên đơn cho chị nha.' },
    { title: 'Kiểm tra hàng', text: 'Dạ chị được kiểm tra hàng thoải mái trước khi thanh toán ạ.' },
    { title: 'Cảm ơn', text: 'Dạ em cảm ơn chị đã đặt hàng ạ! Shop sẽ giao trong 2-4 ngày ạ.' },
  ];
  state.quickReplies = state.quickReplies.filter((q) => q.shopKey !== sk);
  for (const t of templates) {
    state.quickReplies.push({ id: uid('qr'), shopKey: sk, title: t.title, text: t.text });
  }
  return ok({ quickReplies: state.quickReplies.filter((q) => q.shopKey === sk) });
}

function hApplyPerShopDataIsolation(state: State, ctx: ActionContext, _args: Record<string, any>): ActionResult {
  const E = extState(state);
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  // CHỈ đánh dấu đã áp dụng. KHÔNG xóa dữ liệu cũ (quy tắc 2026-11-09 16:48).
  const counts: Record<string, number> = {};
  for (const shop of state.shops) {
    counts[shop.key] = shopOrders(state, shop.key).length;
  }
  E.dataIsolationApplied = true;
  return ok({ applied: true, orderCountsByShop: counts, note: 'Đã đánh dấu áp dụng cách ly dữ liệu theo shop. Dữ liệu cũ được GIỮ NGUYÊN, chỉ Super Admin thấy để test.' });
}

function hMigrateMetaConnections(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = ctxIsSuperAdmin(ctx) ? (args.shopKey as string | undefined) : ctxShopKey(ctx) ?? undefined;
  let migrated = 0;
  for (const shop of state.shops) {
    if (sk && shop.key !== sk) continue;
    const e = shop as ShopExt;
    for (const page of e.meta?.pages ?? []) {
      if (page.shopKey !== shop.key) { page.shopKey = shop.key; migrated++; }
      if (!page.connectedAt) page.connectedAt = nowIso();
    }
    for (const f of state.fanpages.filter((x) => x.pageId && (e.meta?.pages ?? []).some((p) => p.id === x.pageId))) {
      if (f.shopKey !== shop.key) { f.shopKey = shop.key; migrated++; }
    }
  }
  return ok({ migrated, note: 'Đã chuẩn hoá kết nối Meta (page -> đúng shop). Không xóa kết nối nào.' });
}

function hSaveRecord(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const kind = String(args.kind ?? '');
  const rec = args.record ?? args;
  if (!kind || !rec) return fail('Thiếu kind hoặc record.');
  const id = String(rec.id ?? uid('rec'));
  const existing = E.records[kind]?.[id];
  if (existing && !canAccess(ctx, existing.shopKey)) return fail('Bản ghi không thuộc shop của bạn.');
  E.records[kind] = { ...(E.records[kind] ?? {}), [id]: { ...rec, id, shopKey: sk, updatedAt: nowIso() } };
  return ok({ kind, record: E.records[kind][id] });
}

function hDeleteRecordByKind(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const kind = String(args.kind ?? '');
  const id = String(args.id ?? args.recordId ?? '');
  const rec = E.records[kind]?.[id];
  if (!rec || !canAccess(ctx, rec.shopKey)) return fail('Không tìm thấy bản ghi (hoặc bản ghi không thuộc shop của bạn).');
  delete E.records[kind][id];
  return ok({ kind, deletedId: id });
}

function hSaveSingleton(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const key = String(args.key ?? '');
  if (!key) return fail('Thiếu key singleton.');
  // Singleton theo shop: key tự mang shopKey trừ khi Super Admin lưu key chung.
  const fullKey = ctxIsSuperAdmin(ctx) && args.global === true ? key : `${effectiveShopKey(ctx, args) ?? 'global'}:${key}`;
  E.singletons[fullKey] = args.value ?? null;
  return ok({ key: fullKey, value: E.singletons[fullKey] });
}

function hApplyProductShipFeeRules(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  if (!getShop(state, sk)) return fail('Không tìm thấy shop.');
  if (Array.isArray(args.rules)) {
    const rules = normalizeShipRules(args.rules, sk);
    if (rules) state.shipFeeRulesByShop[sk] = rules;
  }
  return ok({ shopKey: sk, applied: true, shipFeeRules: state.shipFeeRulesByShop[sk] ?? [], note: 'Quy tắc phí theo loại sản phẩm đã áp dụng (thay cho mức theo shop/page).' });
}

function hApplyPickupPointConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const cfg = args.config ?? args;
  shop.pickup = {
    name: cfg.name ?? shop.pickup?.name,
    phone: cfg.phone ?? shop.pickup?.phone,
    address: cfg.address ?? shop.pickup?.address,
    province: cfg.province ?? shop.pickup?.province,
    district: cfg.district ?? shop.pickup?.district,
    ward: cfg.ward ?? shop.pickup?.ward,
  };
  return ok({ shopKey: sk, pickup: shop.pickup });
}

function hApplyXinhOrderPrice(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  if (!getShop(state, sk)) return fail('Không tìm thấy shop.');
  // Giá Xinh: 50k/đôi; 1 đôi 80k, 2 đôi 100k, 3 đôi 150k, miễn ship từ 2 đôi.
  for (const p of state.products.filter((x) => x.shopKey === sk)) {
    p.price = 50000;
  }
  state.shipFeeRulesByShop[sk] = [
    { id: uid('rule'), name: 'Quai ngang 1 đôi ship 30k', scope: 'group', groupName: 'Quai ngang', productId: null, minQty: 1, maxQty: 1, fee: 30000, enabled: true },
    { id: uid('rule'), name: 'Quai ngang từ 2 đôi miễn ship', scope: 'group', groupName: 'Quai ngang', productId: null, minQty: 2, maxQty: null, fee: 0, enabled: true },
  ];
  void args;
  return ok({ shopKey: sk, applied: true, unitPrice: 50000, shipFeeRules: state.shipFeeRulesByShop[sk], note: 'Đã áp dụng giá Xinh: 50k/đôi, 1 đôi 80k / 2 đôi 100k / 3 đôi 150k, miễn ship từ 2 đôi.' });
}

// ---------------------------------------------------------------------------
// Handlers: chăm sóc / mời / bình luận / hội thoại
// ---------------------------------------------------------------------------

function hGetCareSettings(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  return ok({ shopKey: sk, settings: E.careSettings[sk] ?? { nudgeAfterMinutes: 5, enabled: true } });
}

function hSaveCareSettings(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  E.careSettings[sk] = { ...(args.settings ?? args) };
  delete (E.careSettings[sk] as Record<string, unknown>).shopKey;
  return ok({ shopKey: sk, settings: E.careSettings[sk] });
}

async function hRunCareNudges(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const settings = E.careSettings[sk] ?? { nudgeAfterMinutes: 5, enabled: true };
  if (settings.enabled === false) return ok({ shopKey: sk, due: [], sent: 0, note: 'Chăm sóc sau im lặng đang tắt.' });
  const afterMs = Number(settings.nudgeAfterMinutes ?? 5) * 60 * 1000;
  const now = Date.now();
  const due: Array<Record<string, unknown>> = [];
  let sent = 0;
  for (const conv of state.conversations) {
    const c = conv as ConversationExt;
    if (c.shopKey !== sk || (c as unknown as Record<string, unknown>).closed || c.nudgeSent) continue;
    const last = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : new Date(c.updatedAt).getTime();
    if (c.lastMessageFrom === 'page' && now - last >= afterMs) {
      const { token } = getPageToken(state, sk, c.fanpageId);
      const text = 'Dạ chị ơi, mẫu này còn size của chị ạ. Chị để lại SĐT + địa chỉ để em lên đơn cho chị nha, 2 đôi 99k miễn ship ạ.';
      if (token && c.customerPsid) {
        const r = await sendMessengerMessage(token, c.customerPsid, text);
        if (r.ok) {
          c.nudgeSent = true;
          c.messages = [...c.messages, { id: uid('msg'), sender: 'page', text, createdAt: nowIso() }];
          c.updatedAt = nowIso();
          sent++;
          due.push({ conversationId: c.id, psid: c.customerPsid, sent: true });
          continue;
        }
        due.push({ conversationId: c.id, psid: c.customerPsid, sent: false, error: r.error });
        continue;
      }
      due.push({ conversationId: c.id, psid: c.customerPsid, sent: false, error: 'Chưa kết nối page (thiếu page token) nên chưa gửi được tin chăm sóc.' });
    }
  }
  void args;
  return ok({ shopKey: sk, due, sent, note: 'Chăm sóc sau 5 phút im lặng: mỗi hội thoại chỉ gửi đúng 1 tin.' });
}

function hGetInviteSettings(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  return ok({ shopKey: sk, settings: E.inviteSettings[sk] ?? { enabled: true } });
}

function hSaveInviteSettings(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  E.inviteSettings[sk] = { ...(args.settings ?? args) };
  delete (E.inviteSettings[sk] as Record<string, unknown>).shopKey;
  return ok({ shopKey: sk, settings: E.inviteSettings[sk] });
}

function hSaveCommentScript(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const s = args.script ?? args;
  const id = String(s.id ?? uid('cms'));
  const script: CommentScriptExt = { ...(s as Record<string, unknown>), id, shopKey: sk, updatedAt: nowIso() } as CommentScriptExt;
  const idx = E.commentScripts.findIndex((x) => x.id === id);
  if (idx >= 0) E.commentScripts[idx] = script;
  else E.commentScripts.push(script);
  return ok({ script });
}

async function hSyncConversations(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const pageId = String(args.pageId ?? '');
  const { token, page } = getPageToken(state, sk, pageId || undefined);
  if (!token || !page) return fail('Page chưa kết nối (thiếu page token). Kết nối page trước rồi đồng bộ lại.');
  const r = await graphGet<{ data?: any[] }>(`/${page.id}/conversations`, token, { fields: 'id,participants,updated_time,messages{id,message,from,created_time}' });
  if (!r.ok) return fail(`Đồng bộ hội thoại thất bại: ${r.error}`);
  let n = 0;
  for (const c of r.data?.data ?? []) {
    const psid = c.participants?.data?.find((p: any) => p.id !== page.id)?.id ?? '';
    const id = `fb_${c.id}`;
    const existing = state.conversations.find((x) => x.id === id);
    const conv: Conversation = {
      id,
      shopKey: sk,
      fanpageId: page.id,
      customerPsid: psid,
      customerName: c.participants?.data?.find((p: any) => p.id !== page.id)?.name ?? '',
      messages: (c.messages?.data ?? []).map((m: any) => ({ id: String(m.id ?? uid('msg')), sender: m.from?.id === page.id ? 'page' : 'customer', text: String(m.message ?? ''), createdAt: String(m.created_time ?? nowIso()) })),
      orderClosed: existing?.orderClosed ?? false,
      updatedAt: String(c.updated_time ?? nowIso()),
    };
    if (existing) {
      const idx = state.conversations.indexOf(existing);
      state.conversations[idx] = conv;
    } else {
      state.conversations.push(conv);
    }
    n++;
  }
  return ok({ shopKey: sk, pageId: page.id, synced: n });
}

async function hSyncComments(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const pageId = String(args.pageId ?? '');
  const { token, page } = getPageToken(state, sk, pageId || undefined);
  if (!token || !page) return fail('Page chưa kết nối (thiếu page token). Kết nối page trước rồi đồng bộ lại.');
  const r = await graphGet<{ data?: any[] }>(`/${page.id}/posts`, token, { fields: 'id,message,comments{id,message,from,created_time,like_count}' });
  if (!r.ok) return fail(`Đồng bộ bình luận thất bại: ${r.error}`);
  let n = 0;
  for (const post of r.data?.data ?? []) {
    for (const cm of post.comments?.data ?? []) {
      const id = `fb_${cm.id}`;
      const item: CommentExt = {
        id, shopKey: sk, pageId: page.id, postId: post.id, fbId: String(cm.id),
        text: String(cm.message ?? ''), from: cm.from, at: String(cm.created_time ?? ''), status: 'pending',
      };
      const idx = E.comments.findIndex((x) => x.id === id);
      if (idx >= 0) E.comments[idx] = item;
      else E.comments.push(item);
      n++;
    }
  }
  return ok({ shopKey: sk, pageId: page.id, synced: n });
}

async function hProcessCommentQueue(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const pending = E.comments.filter((c) => c.shopKey === sk && c.status === 'pending');
  const scripts = E.commentScripts.filter((s) => s.shopKey === sk);
  const results: Array<Record<string, unknown>> = [];
  const { token } = getPageToken(state, sk);
  for (const c of pending) {
    const text = String(c.text ?? '').toLowerCase();
    let reply = 'Dạ chị inbox giúp shop để em tư vấn size + lên đơn cho chị nha ạ.';
    for (const s of scripts) {
      const kws: string[] = Array.isArray(s.keywords) ? s.keywords : [];
      if (s.reply && kws.some((k) => k && text.includes(String(k).toLowerCase()))) { reply = String(s.reply); break; }
    }
    if (/\b(4[0-9]|3[0-5])\b/.test(text) && /size/.test(text)) {
      reply = 'Dạ shop em chỉ có size 36 đến 39 thôi ạ. Chị xem chân mình có vừa size nào thì lấy cho em nha.';
    } else if (/giá|gia|bao nhiêu/.test(text)) {
      reply = 'Dạ 2 đôi 99k miễn ship ạ. Chị inbox giúp shop để em lên đơn cho chị nha.';
    }
    if (args.autoSend === true && token && c.fbId) {
      const r = await graphPost(`/${c.fbId}/comments`, token, { message: reply });
      if (r.ok) {
        c.status = 'replied-public';
        c.reply = reply;
        results.push({ commentId: c.id, ok: true, sent: true });
        continue;
      }
      results.push({ commentId: c.id, ok: false, error: r.error, plannedReply: reply });
      continue;
    }
    c.status = 'planned';
    c.reply = reply;
    results.push({ commentId: c.id, ok: true, sent: false, plannedReply: reply });
  }
  return ok({ shopKey: sk, processed: results.length, results, note: args.autoSend === true ? 'Đã trả lời công khai các bình luận chờ.' : 'Mới lập kế hoạch trả lời (chưa gửi). Gọi lại với autoSend:true để gửi thật.' });
}

function hProcessAiQueue(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const pending = E.aiDrafts.filter((d) => d.shopKey === sk && d.status === 'pending');
  const results: Array<Record<string, unknown>> = [];
  for (const d of pending) {
    // Hàng đợi AI: chỉ tự duyệt khi rule khớp cấu hình autoApprove; còn lại giữ chờ duyệt tay.
    if (args.autoApprove === true) {
      d.status = 'approved';
      results.push({ draftId: d.id, ok: true, action: 'approved' });
    } else {
      results.push({ draftId: d.id, ok: true, action: 'kept-pending' });
    }
  }
  return ok({ shopKey: sk, processed: results.length, results });
}

async function hSendChatMessage(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const conv = state.conversations.find((c) => c.id === String(args.conversationId ?? ''));
  if (!conv || !canAccess(ctx, conv.shopKey)) return fail('Không tìm thấy hội thoại.');
  const text = String(args.text ?? args.message ?? '');
  if (!text) return fail('Thiếu nội dung tin nhắn.');
  const { token } = getPageToken(state, sk, conv.fanpageId);
  if (!token || !conv.customerPsid) return fail('Không gửi được: thiếu page token hoặc PSID.');
  const r = await sendMessengerMessage(token, conv.customerPsid, text);
  if (!r.ok) return fail(`Gửi tin nhắn thất bại: ${r.error}`);
  const e = conv as ConversationExt;
  conv.messages = [...conv.messages, { id: uid('msg'), sender: 'page', text, createdAt: nowIso() }];
  conv.updatedAt = nowIso();
  e.lastMessageAt = nowIso();
  e.lastMessageFrom = 'page';
  return ok({ conversationId: conv.id, messageId: r.data?.message_id });
}

async function hSendChatImage(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const conv = state.conversations.find((c) => c.id === String(args.conversationId ?? ''));
  if (!conv || !canAccess(ctx, conv.shopKey)) return fail('Không tìm thấy hội thoại.');
  const imageUrl = String(args.imageUrl ?? args.url ?? '');
  if (!imageUrl) return fail('Thiếu URL ảnh.');
  const { token } = getPageToken(state, sk, conv.fanpageId);
  if (!token || !conv.customerPsid) return fail('Không gửi được: thiếu page token hoặc PSID.');
  const r = await sendMessengerImage(token, conv.customerPsid, imageUrl);
  if (!r.ok) return fail(`Gửi ảnh thất bại: ${r.error}`);
  const e = conv as ConversationExt;
  conv.messages = [...conv.messages, { id: uid('msg'), sender: 'page', text: `[ảnh] ${imageUrl}`, createdAt: nowIso() }];
  conv.updatedAt = nowIso();
  e.lastMessageAt = nowIso();
  e.lastMessageFrom = 'page';
  return ok({ conversationId: conv.id, messageId: r.data?.message_id });
}

async function hReplyCommentPublic(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const c = E.comments.find((x) => x.id === String(args.commentId ?? ''));
  if (!c || !canAccess(ctx, c.shopKey)) return fail('Không tìm thấy bình luận.');
  const text = String(args.text ?? args.message ?? c.reply ?? '');
  if (!text) return fail('Thiếu nội dung trả lời.');
  const { token } = getPageToken(state, sk, c.pageId);
  if (!token || !c.fbId) return fail('Page chưa kết nối (thiếu page token).');
  const r = await graphPost(`/${c.fbId}/comments`, token, { message: text });
  if (!r.ok) return fail(`Trả lời bình luận thất bại: ${r.error}`);
  c.status = 'replied-public';
  c.reply = text;
  return ok({ commentId: c.id, reply: text });
}

function hPushCommentToInbox(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const c = E.comments.find((x) => x.id === String(args.commentId ?? ''));
  if (!c || !canAccess(ctx, c.shopKey)) return fail('Không tìm thấy bình luận.');
  // Facebook chặn nhắn riêng người chỉ bình luận mà chưa từng nhắn page — chỉ tạo
  // hội thoại chờ, KHÔNG tự gửi tin riêng (gửi sẽ lỗi #10).
  const id = uid('conv');
  const conv: Conversation = {
    id,
    shopKey: sk,
    fanpageId: c.pageId ?? '',
    customerPsid: c.from?.id ?? '',
    customerName: c.from?.name ?? '',
    messages: [{ id: uid('msg'), sender: 'customer', text: String(c.text ?? ''), createdAt: String(c.at ?? nowIso()) }],
    orderClosed: false,
    updatedAt: nowIso(),
  };
  (conv as ConversationExt).source = 'comment';
  (conv as ConversationExt).commentId = c.id;
  state.conversations.push(conv);
  c.status = 'pushed-to-inbox';
  return ok({
    conversationId: id,
    note: 'Đã đưa bình luận vào inbox để theo dõi. Chỉ gửi được tin riêng khi khách đã từng nhắn page (Facebook chặn nhắn riêng người chỉ bình luận).',
  });
}

function hMarkCommentsRead(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const ids: string[] = Array.isArray(args.commentIds) ? args.commentIds : args.commentId ? [String(args.commentId)] : [];
  let n = 0;
  for (const id of ids) {
    const c = E.comments.find((x) => x.id === id);
    if (c && c.shopKey === sk) { c.read = true; n++; }
  }
  return ok({ marked: n });
}

function findConversation(state: State, ctx: ActionContext, id: string): Conversation | undefined {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv || !canAccess(ctx, conv.shopKey)) return undefined;
  return conv;
}

function hSaveConversationNote(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const conv = findConversation(state, ctx, String(args.conversationId ?? ''));
  if (!conv) return fail('Không tìm thấy hội thoại.');
  (conv as ConversationExt).note = String(args.note ?? '');
  return ok({ conversationId: conv.id, note: (conv as ConversationExt).note });
}

function hAddInternalNote(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const conv = findConversation(state, ctx, String(args.conversationId ?? ''));
  if (!conv) return fail('Không tìm thấy hội thoại.');
  const text = String(args.text ?? args.note ?? '');
  if (!text) return fail('Thiếu nội dung ghi chú.');
  const e = conv as ConversationExt;
  const note = { id: uid('nt'), text, at: nowIso(), by: ctxAccountId(ctx) };
  e.internalNotes = [...(e.internalNotes ?? []), note];
  return ok({ conversationId: conv.id, note });
}

function hDeleteInternalNote(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const conv = findConversation(state, ctx, String(args.conversationId ?? ''));
  if (!conv) return fail('Không tìm thấy hội thoại.');
  const id = String(args.noteId ?? '');
  const e = conv as ConversationExt;
  e.internalNotes = (e.internalNotes ?? []).filter((n) => n.id !== id);
  return ok({ conversationId: conv.id, deletedId: id });
}

function hSetConversationHashtags(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const conv = findConversation(state, ctx, String(args.conversationId ?? ''));
  if (!conv) return fail('Không tìm thấy hội thoại.');
  (conv as ConversationExt).hashtags = Array.isArray(args.hashtags) ? args.hashtags : [];
  return ok({ conversationId: conv.id, hashtags: (conv as ConversationExt).hashtags });
}

function hUpdateChatHashtag(state: State, _ctx: ActionContext, args: Record<string, any>): ActionResult {
  const id = String(args.hashtagId ?? args.id ?? '');
  const h = state.hashtags.find((x) => x.id === id);
  if (!h) return fail('Không tìm thấy nhãn hashtag.');
  // Nhãn hashtag là nhãn quy trình dùng chung mọi shop (ghi nhận 2026-11-09).
  if (args.label !== undefined) h.label = String(args.label);
  if (args.name !== undefined) h.label = String(args.name);
  return ok({ hashtag: h });
}

function hDeleteChatHashtag(state: State, _ctx: ActionContext, args: Record<string, any>): ActionResult {
  const id = String(args.hashtagId ?? args.id ?? '');
  const idx = state.hashtags.findIndex((x) => x.id === id);
  if (idx < 0) return fail('Không tìm thấy nhãn hashtag.');
  state.hashtags.splice(idx, 1);
  return ok({ deletedId: id });
}

function hAssignConversation(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const conv = findConversation(state, ctx, String(args.conversationId ?? ''));
  if (!conv) return fail('Không tìm thấy hội thoại.');
  const e = conv as ConversationExt;
  e.assigneeId = args.assigneeId ?? args.accountId ?? null;
  e.assigneeName = args.assigneeName ?? null;
  return ok({ conversationId: conv.id, assigneeId: e.assigneeId });
}

function hAppendLocalMessage(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const conv = findConversation(state, ctx, String(args.conversationId ?? ''));
  if (!conv) return fail('Không tìm thấy hội thoại.');
  const msg = { id: uid('msg'), sender: (args.from ?? 'page') as 'page' | 'customer', text: String(args.text ?? ''), createdAt: nowIso() };
  conv.messages = [...conv.messages, msg];
  conv.updatedAt = nowIso();
  const e = conv as ConversationExt;
  e.lastMessageAt = nowIso();
  e.lastMessageFrom = msg.sender;
  return ok({ conversationId: conv.id, message: msg });
}

function hApproveAiDraft(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const d = E.aiDrafts.find((x) => x.id === String(args.draftId ?? args.id ?? ''));
  if (!d || !canAccess(ctx, d.shopKey)) return fail('Không tìm thấy bản nháp AI.');
  d.status = 'approved';
  d.reviewedBy = ctxAccountId(ctx);
  return ok({ draft: d });
}

function hRejectAiDraft(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const d = E.aiDrafts.find((x) => x.id === String(args.draftId ?? args.id ?? ''));
  if (!d || !canAccess(ctx, d.shopKey)) return fail('Không tìm thấy bản nháp AI.');
  d.status = 'rejected';
  d.reviewedBy = ctxAccountId(ctx);
  d.rejectReason = String(args.reason ?? '');
  return ok({ draft: d });
}

// ---------------------------------------------------------------------------
// Handlers: chiến dịch / live / Meta OAuth / misc
// ---------------------------------------------------------------------------

async function hSendCampaign(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const recipients: string[] = Array.isArray(args.recipients) ? args.recipients : [];
  const text = String(args.message ?? args.text ?? '');
  if (!text) return fail('Thiếu nội dung chiến dịch.');
  if (recipients.length === 0) return fail('Chưa có người nhận.');
  if (recipients.length > 50) return fail('Mỗi lần gửi tối đa 50 người nhận.');
  const { token } = getPageToken(state, sk, args.pageId);
  if (!token) return fail('Page chưa kết nối (thiếu page token).');
  const id = uid('cmp');
  const results: Array<Record<string, unknown>> = [];
  for (const psid of recipients) {
    const r = await sendMessengerMessage(token, psid, text);
    results.push({ psid, ok: r.ok, error: r.ok ? undefined : r.error });
  }
  const campaign = {
    id, shopKey: sk, name: String(args.name ?? `Chiến dịch ${new Date().toLocaleDateString('vi-VN')}`),
    status: 'active' as Campaign['status'], createdAt: nowIso(),
    message: text, pageId: args.pageId,
    sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length,
    results, at: nowIso(), by: ctxAccountId(ctx),
  } satisfies CampaignExt;
  state.campaigns.push(campaign);
  return ok({ campaign });
}

function hRefreshCampaignStats(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const c = state.campaigns.find((x) => x.id === String(args.campaignId ?? args.id ?? '')) as CampaignExt | undefined;
  if (!c || !canAccess(ctx, c.shopKey)) return fail('Không tìm thấy chiến dịch.');
  return ok({ campaignId: c.id, sent: c.sent ?? 0, failed: c.failed ?? 0, total: (c.sent ?? 0) + (c.failed ?? 0) });
}

function hSaveLiveSession(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const s = args.session ?? args;
  const id = String(s.id ?? uid('live'));
  const existing = E.liveSessions.find((x) => x.id === id);
  const session: LiveSessionExt = { ...(existing ?? {}), ...s, id, shopKey: sk, updatedAt: nowIso() } as LiveSessionExt;
  if (existing) {
    const idx = E.liveSessions.indexOf(existing);
    E.liveSessions[idx] = session;
  } else {
    E.liveSessions.push(session);
  }
  return ok({ session });
}

function hStartLiveSession(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const session: LiveSessionExt = {
    id: uid('live'), shopKey: sk, pageId: args.pageId, title: String(args.title ?? 'Livestream'),
    status: 'live', startedAt: nowIso(), comments: [], by: ctxAccountId(ctx),
  };
  E.liveSessions.push(session);
  return ok({ session });
}

function hEndLiveSession(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const s = E.liveSessions.find((x) => x.id === String(args.sessionId ?? args.id ?? ''));
  if (!s || !canAccess(ctx, s.shopKey)) return fail('Không tìm thấy phiên live.');
  s.status = 'ended';
  s.endedAt = nowIso();
  return ok({ session: s });
}

function hDeleteLiveSession(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const idx = E.liveSessions.findIndex((x) => x.id === String(args.sessionId ?? args.id ?? ''));
  if (idx < 0 || !canAccess(ctx, E.liveSessions[idx].shopKey)) return fail('Không tìm thấy phiên live.');
  const [deleted] = E.liveSessions.splice(idx, 1);
  return ok({ deletedId: deleted.id });
}

function hAddLiveComment(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const s = E.liveSessions.find((x) => x.id === String(args.sessionId ?? ''));
  if (!s || !canAccess(ctx, s.shopKey)) return fail('Không tìm thấy phiên live.');
  const text = String(args.text ?? '');
  if (!text) return fail('Thiếu nội dung bình luận.');
  const comment = { id: uid('lc'), text, from: args.from ?? {}, at: nowIso(), ordered: false };
  s.comments = [...(s.comments ?? []), comment];
  return ok({ sessionId: s.id, comment });
}

function hDeleteLiveComment(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const s = E.liveSessions.find((x) => x.id === String(args.sessionId ?? ''));
  if (!s || !canAccess(ctx, s.shopKey)) return fail('Không tìm thấy phiên live.');
  const id = String(args.commentId ?? '');
  s.comments = (s.comments ?? []).filter((c) => c.id !== id);
  return ok({ sessionId: s.id, deletedId: id });
}

function hMarkLiveCommentOrdered(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const E = extState(state);
  const s = E.liveSessions.find((x) => x.id === String(args.sessionId ?? ''));
  if (!s || !canAccess(ctx, s.shopKey)) return fail('Không tìm thấy phiên live.');
  const c = (s.comments ?? []).find((x) => x.id === String(args.commentId ?? ''));
  if (!c) return fail('Không tìm thấy bình luận trong phiên live.');
  c.ordered = true;
  c.orderId = args.orderId ?? null;
  return ok({ sessionId: s.id, comment: c });
}

function hGetOAuthUrl(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  // Quy tắc 2026-11-09 17:08/17:18: ô "KẾT NỐI CHO SHOP NÀO?" chỉ hiện shop của
  // chính tài khoản đang đăng nhập (tự chọn sẵn); Super Admin mới thấy đủ danh sách.
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  const appId = String(args.appId ?? shop?.meta?.appId ?? state.metaConfig.appId ?? '');
  const redirectUri = String(args.redirectUri ?? shop?.meta?.redirectUri ?? state.metaConfig.redirectUri ?? '');
  if (!appId) return fail('Thiếu Meta App ID trong cấu hình Meta của shop.');
  if (!isValidRedirectUri(redirectUri)) return fail(invalidRedirectUriError());
  const url = buildOAuthUrl({ appId, redirectUri, state: `${sk}:${uid('st')}` });
  const shopChoices = ctxIsSuperAdmin(ctx)
    ? state.shops.map((s) => ({ key: s.key, name: s.name }))
    : [{ key: sk, name: shop?.name ?? sk }];
  return ok({ url, shopKey: sk, shopChoices });
}

async function hExchangeOAuthCode(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const appId = String(shop.meta?.appId ?? state.metaConfig.appId ?? args.appId ?? '');
  const appSecret = String(shop.meta?.appSecret ?? '');
  const redirectUri = String(args.redirectUri ?? shop.meta?.redirectUri ?? state.metaConfig.redirectUri ?? '');
  const code = String(args.code ?? '');
  if (!appId || !appSecret || !code) return fail('Thiếu App ID/App Secret/code để đổi token.');
  if (!isValidRedirectUri(redirectUri)) return fail(invalidRedirectUriError());
  const r = await exchangeCodeForToken({ appId, appSecret, redirectUri, code });
  if (!r.ok) return fail(`Đổi code OAuth thất bại: ${r.error}`);
  shop.meta = { ...(shop.meta ?? {}), userAccessToken: r.data?.access_token };
  return ok({ shopKey: sk, hasUserToken: true, expiresIn: r.data?.expires_in });
}

async function hVerifyFacebookToken(_state: State, _ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const token = String(args.token ?? args.accessToken ?? '');
  if (!token) return fail('Thiếu access token để kiểm tra.');
  const r = await graphGet<{ id: string; name?: string }>('/me', token, { fields: 'id,name' });
  if (!r.ok) return fail(`Token không hợp lệ: ${r.error}`);
  const perms = await graphGet<{ data?: Array<{ permission: string; status: string }> }>('/me/permissions', token);
  return ok({
    valid: true,
    id: r.data?.id,
    name: r.data?.name,
    permissions: perms.ok ? (perms.data?.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission) : [],
  });
}

function upsertPageConnection(state: State, shopKey: string, pageId: string, name: string | undefined, pageToken: string): void {
  const shop = getShop(state, shopKey) as ShopExt | undefined;
  if (!shop) return;
  shop.meta = { ...(shop.meta ?? {}) };
  shop.meta.pages = [
    ...(shop.meta.pages ?? []).filter((p) => p.id !== pageId),
    { id: pageId, name, accessToken: pageToken, shopKey, connectedAt: nowIso() },
  ];
  const existing = state.fanpages.find((f) => f.pageId === pageId);
  if (existing) {
    existing.shopKey = shopKey;
    existing.name = name ?? existing.name;
    existing.connected = true;
  } else {
    state.fanpages.push({ id: `fp_${pageId}`, shopKey, pageId, name: name ?? pageId, connected: true });
  }
}

async function hConnectFanpages(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const token = String(args.userAccessToken ?? shop.meta?.userAccessToken ?? '');
  if (!token) return fail('Thiếu user access token. Đăng nhập Facebook trước qua getoauthurl.');
  const limits = shopLimits(state, shop);
  const r = await listManagedPages(token);
  if (!r.ok) return fail(`Không lấy được danh sách page: ${r.error}`);
  const pages = r.data ?? [];
  if (pages.length > limits.pages) {
    return fail(`Tài khoản có ${pages.length} page, vượt hạn mức ${limits.pages} page của gói. ${quotaError(state, 'page', limits.pages)}`);
  }
  shop.meta = { ...(shop.meta ?? {}), userAccessToken: token };
  for (const p of pages) {
    if (p.access_token) upsertPageConnection(state, sk, p.id, p.name, p.access_token);
  }
  return ok({ shopKey: sk, pages: (shop.meta.pages ?? []).map((p) => ({ id: p.id, name: p.name, connectedAt: p.connectedAt })) });
}

async function hConnectPageWithToken(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const pageId = String(args.pageId ?? '');
  const pageToken = String(args.pageAccessToken ?? args.token ?? '');
  if (!pageId || !pageToken) return fail('Thiếu pageId hoặc pageAccessToken. (Trong lúc chờ deploy Render, nối page gấp dùng đường dán tay này, không cần OAuth.)');
  const limits = shopLimits(state, shop);
  const existing = shop.meta?.pages ?? [];
  if (!existing.some((p) => p.id === pageId) && existing.length >= limits.pages) {
    return fail(quotaError(state, 'page', limits.pages));
  }
  const r = await graphGet<{ id: string; name?: string }>(`/${pageId}`, pageToken, { fields: 'id,name' });
  if (!r.ok) return fail(`Token page không hợp lệ: ${r.error}`);
  upsertPageConnection(state, sk, pageId, r.data?.name, pageToken);
  return ok({ shopKey: sk, page: { id: pageId, name: r.data?.name } });
}

function hDisconnectFanpage(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const pageId = String(args.pageId ?? '');
  shop.meta = { ...(shop.meta ?? {}) };
  shop.meta.pages = (shop.meta.pages ?? []).filter((p) => p.id !== pageId);
  state.fanpages = state.fanpages.filter((f) => !(f.shopKey === sk && f.pageId === pageId));
  return ok({ shopKey: sk, disconnectedPageId: pageId });
}

function hDisconnectCarrier(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const carrier = String(args.carrier ?? '');
  if (shop.carrierConfigs) delete shop.carrierConfigs[carrier];
  return ok({ shopKey: sk, disconnectedCarrier: carrier });
}

function hVerifyWebhook(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  const appSecret = String(args.appSecret ?? shop?.meta?.appSecret ?? '');
  const rawBody = String(args.rawBody ?? args.body ?? '');
  const signature = String(args.signature ?? args['X-Hub-Signature-256'] ?? '');
  if (!appSecret) return fail('Thiếu App Secret để verify webhook.');
  const valid = verifyWebhookSignature(appSecret, rawBody, signature);
  return ok({ shopKey: sk, valid });
}

async function hReceiveWebhookEvent(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const provider = String(args.provider ?? args.source ?? 'meta');
  if (provider === 'best') {
    const parsed = bestWebhookReceive(args.payload ?? args);
    if (!parsed.ok) return fail(parsed.error ?? 'Webhook Best không hợp lệ.');
    // Cập nhật trạng thái vận đơn cho đơn khớp merchantCode (bỏ hậu tố -R1/-R2).
    const order = state.orders.find((o) => o.code === parsed.orderCode && canAccess(ctx, o.shopKey));
    if (order && parsed.waybillCode) {
      const e = order as OrderExt;
      e.shipHistory = [...(e.shipHistory ?? []), { at: nowIso(), carrier: 'BEST', waybillCode: parsed.waybillCode, status: parsed.status, source: 'webhook' }];
    }
    return ok({ provider: 'best', event: parsed.event, orderCode: parsed.orderCode, waybillCode: parsed.waybillCode, status: parsed.status });
  }
  // Webhook Meta (messaging): ghi nhận tin nhắn vào hội thoại, không tự trả lời ở đây.
  const entry = args.entry ?? args.payload;
  const messaging: any[] = Array.isArray(entry) ? entry.flatMap((e: any) => e.messaging ?? []) : [];
  let stored = 0;
  for (const m of messaging) {
    const psid = m.sender?.id;
    const text = m.message?.text;
    if (!psid || !text) continue;
    const sk = ctxShopKey(ctx) ?? '';
    const id = `fb_${m.recipient?.id ?? 'page'}_${psid}`;
    const existing = state.conversations.find((c) => c.id === id);
    if (existing) {
      existing.messages = [...existing.messages, { id: uid('msg'), sender: 'customer', text: String(text), createdAt: nowIso() }];
      existing.updatedAt = nowIso();
    } else {
      state.conversations.push({
        id, shopKey: sk, fanpageId: String(m.recipient?.id ?? ''), customerPsid: String(psid),
        customerName: '', messages: [{ id: uid('msg'), sender: 'customer', text: String(text), createdAt: nowIso() }],
        orderClosed: false, updatedAt: nowIso(),
      });
    }
    stored++;
  }
  return ok({ provider: 'meta', stored });
}

function hSaveMetaConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  const cfg = args.config ?? args;
  // App ID + Redirect URI là cấu hình Meta App CHUNG (toàn hệ thống).
  if (cfg.appId !== undefined) state.metaConfig.appId = String(cfg.appId);
  if (cfg.redirectUri !== undefined) {
    if (!isValidRedirectUri(String(cfg.redirectUri))) return fail(invalidRedirectUriError());
    state.metaConfig.redirectUri = String(cfg.redirectUri);
  }
  if (cfg.appSecret) {
    shop.meta = { ...(shop.meta ?? {}), appSecret: String(cfg.appSecret) };
  }
  return ok({ shopKey: sk, meta: { appId: state.metaConfig.appId, redirectUri: state.metaConfig.redirectUri, hasAppSecret: Boolean(shop.meta?.appSecret) } });
}

// ---------------------------------------------------------------------------
// TikTok Shop
// ---------------------------------------------------------------------------

function tiktokCfgOf(state: State, sk: string): TikTokShopConfig | null {
  const shop = getShop(state, sk) as ShopExt | undefined;
  return shop?.tiktok ?? null;
}

/**
 * App TikTok CHUNG của nền tảng (mô hình Achat — 1 app, mọi shop chỉ ủy
 * quyền). State cũ chưa có trường này thì loadState đã gộp mặc định rỗng.
 */
function tiktokPlatformOf(state: State): TikTokPlatformConfig {
  return state.tiktokPlatform ?? {
    appKey: '', appSecret: '', serviceId: '', redirectUri: '', webhookUrl: '', apiVersion: '202309',
  };
}

function requireTikTokPlatform(state: State): TikTokPlatformConfig | ActionResult {
  const platform = tiktokPlatformOf(state);
  if (!tiktokPlatformConfigured(platform)) {
    return fail('App TikTok chung của AChatGo chưa được cấu hình (cần app_key, app_secret, service_id của app chung). Chỉ Super Admin mới nhập được — mở Super Admin → App TikTok chung.');
  }
  return platform;
}

/** Access token còn hạn; tự refresh khi sắp hết (còn < 10 phút). Trả fail khi chưa kết nối / refresh lỗi. */
async function ensureTikTokAccessToken(state: State, sk: string): Promise<string | ActionResult> {
  const platform = tiktokPlatformOf(state);
  const cfg = tiktokCfgOf(state, sk);
  if (!tiktokPlatformConfigured(platform)) return fail('App TikTok chung của AChatGo chưa được cấu hình. Liên hệ Super Admin để nhập app chung trước.');
  if (!cfg?.accessToken || !cfg?.refreshToken) return fail('TikTok Shop chưa kết nối (chưa có access token). Bấm "Kết nối TikTok" để ủy quyền.');
  const nowMs = Date.now();
  const expiringSoon = cfg.accessTokenExpiresAt ? cfg.accessTokenExpiresAt * 1000 - nowMs < 10 * 60 * 1000 : true;
  if (!expiringSoon) return cfg.accessToken;
  const res = await refreshAccessToken({ appKey: platform.appKey, appSecret: platform.appSecret, refreshToken: cfg.refreshToken });
  if (!res.ok) {
    cfg.status = 'expired';
    return fail(`Không làm mới được access token TikTok (${res.error}). Cần kết nối lại TikTok Shop.`);
  }
  cfg.accessToken = res.data.access_token;
  cfg.refreshToken = res.data.refresh_token;
  cfg.accessTokenExpiresAt = res.data.access_token_expire_in;
  cfg.refreshTokenExpiresAt = res.data.refresh_token_expire_in;
  cfg.grantedScopes = res.data.granted_scopes ?? cfg.grantedScopes;
  cfg.chatScopeGranted = hasTikTokChatScope(cfg.grantedScopes);
  cfg.status = 'connected';
  return cfg.accessToken;
}

function hasTikTokChatScope(scopes?: string[]): boolean {
  return (scopes ?? []).some((s) => /customer|message/i.test(s));
}

/** Gọi Business API: credential lấy từ app chung, cipher/token lấy từ shop. */
function tiktokBaseCall(platform: TikTokPlatformConfig, cfg: TikTokShopConfig, accessToken: string): Omit<TikTokApiCall, 'method' | 'path'> {
  return {
    appKey: platform.appKey,
    appSecret: platform.appSecret,
    accessToken,
    shopCipher: cfg.shopCipher,
    apiVersion: platform.apiVersion || '202309',
  };
}

function invalidTikTokUrlError(): string {
  return 'Địa chỉ phải là URL web thật bắt đầu bằng https:// và không chứa phần query/fragment. Đăng ký đúng địa chỉ này trong TikTok Shop Partner Center (mục TikTok Shop App → URLs) trước khi kết nối.';
}

/** URL TikTok (redirect/webhook): https bắt buộc; cho phép http://localhost để test local. Không query/fragment. */
function isValidTikTokUrl(uri: string): boolean {
  if (!uri) return false;
  try {
    const parsed = new URL(uri.trim());
    if (parsed.search || parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

/** Tiền TikTok có thể là chuỗi số hoặc object {amount, currency} — quy về {amount (đồng), currency}. */
function tiktokMoneyObj(m: unknown): { amount: number; currency: string } {
  if (m == null) return { amount: 0, currency: 'VND' };
  if (typeof m === 'string' || typeof m === 'number') return { amount: tiktokMoneyToVnd(m), currency: 'VND' };
  const o = m as Record<string, unknown>;
  return {
    amount: tiktokMoneyToVnd((o.amount ?? o.total ?? o.value) as string | number | undefined),
    currency: typeof o.currency === 'string' ? o.currency : 'VND',
  };
}

/** Biến thể nội bộ của shop (để map SKU TikTok ↔ catalogue). */
function internalVariantsForShop(state: State, sk: string): Array<{ sku: string; color: string; size: string; productId: string }> {
  const out: Array<{ sku: string; color: string; size: string; productId: string }> = [];
  for (const p of state.products) {
    if (p.shopKey !== sk) continue;
    for (const v of p.variants ?? []) {
      if (v.sku) out.push({ sku: v.sku, color: v.color ?? '', size: v.size ?? '', productId: p.id });
    }
  }
  return out;
}

function findInternalVariant(state: State, sk: string, internalSku: string): { product: Product; variant: Variant } | null {
  for (const p of state.products) {
    if (p.shopKey !== sk) continue;
    const v = (p.variants ?? []).find((vv) => vv.sku === internalSku);
    if (v) return { product: p, variant: v };
  }
  return null;
}

/**
 * Lưu app TikTok CHUNG (mô hình Achat) — CHỈ Super Admin. App Secret chỉ ghi
 * đè khi nhập giá trị mới (UI để trống = giữ nguyên, secret không bao giờ
 * hiện lại). Đổi app_key/service_id = token các shop đã ủy quyền dưới app
 * cũ mất hiệu lực → xóa token toàn bộ shop, các shop bấm "Kết nối TikTok"
 * để ủy quyền lại dưới app chung mới.
 */
function hSaveTikTokPlatformConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  const body = (args.config ?? args) as Record<string, unknown>;
  const prev = tiktokPlatformOf(state);
  const redirectUri = typeof body.redirectUri === 'string' && body.redirectUri.trim() ? body.redirectUri.trim() : prev.redirectUri ?? '';
  const webhookUrl = typeof body.webhookUrl === 'string' && body.webhookUrl.trim() ? body.webhookUrl.trim() : prev.webhookUrl ?? '';
  if (redirectUri && !isValidTikTokUrl(redirectUri)) return fail(invalidTikTokUrlError());
  if (webhookUrl && !isValidTikTokUrl(webhookUrl)) return fail(invalidTikTokUrlError());
  const appKey = typeof body.appKey === 'string' && body.appKey.trim() ? body.appKey.trim() : prev.appKey;
  const serviceId = typeof body.serviceId === 'string' && body.serviceId.trim() ? body.serviceId.trim() : prev.serviceId;
  const credsChanged = (appKey && appKey !== prev.appKey) || (serviceId && serviceId !== prev.serviceId);
  const platform: TikTokPlatformConfig = {
    appKey,
    // app_secret chỉ ghi đè khi nhập giá trị mới (UI để trống = giữ nguyên).
    appSecret: typeof body.appSecret === 'string' && body.appSecret.trim() ? body.appSecret.trim() : prev.appSecret,
    serviceId,
    redirectUri,
    webhookUrl,
    authorizeHost: typeof body.authorizeHost === 'string' && body.authorizeHost.trim() ? body.authorizeHost.trim() : prev.authorizeHost,
    apiVersion: typeof body.apiVersion === 'string' && body.apiVersion.trim() ? body.apiVersion.trim() : (prev.apiVersion || '202309'),
    updatedAt: new Date().toISOString(),
  };
  state.tiktokPlatform = platform;
  if (credsChanged) {
    // Token các shop phát hành dưới app cũ → mất hiệu lực, phải ủy quyền lại.
    for (const shop of state.shops) {
      const t = (shop as ShopExt).tiktok;
      if (!t) continue;
      t.accessToken = '';
      t.refreshToken = '';
      t.shopCipher = '';
      t.shopId = '';
      t.shopName = '';
      t.grantedScopes = [];
      t.chatScopeGranted = false;
      t.status = 'disconnected';
    }
  }
  return ok({ platform: tiktokPlatformPublic(platform), tokensCleared: credsChanged });
}

/** Đọc app TikTok chung — CHỈ Super Admin (appSecret không bao giờ trả về). */
function hGetTikTokPlatformConfig(state: State, ctx: ActionContext, _args: Record<string, any>): ActionResult {
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  return ok({ platform: tiktokPlatformPublic(tiktokPlatformOf(state)) });
}

function hGetTikTokOAuthUrl(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  if (!platform.redirectUri) return fail('Chưa nhập Redirect URI cho app TikTok chung. Redirect URI phải khớp đúng địa chỉ đã đăng ký trong TikTok Shop Partner Center (Super Admin → App TikTok chung).');
  const stateParam = createTikTokAuthState(sk);
  const url = buildTikTokAuthorizeUrl({ serviceId: platform.serviceId, state: stateParam, authorizeHost: platform.authorizeHost });
  return ok({ shopKey: sk, url, state: stateParam });
}

async function hExchangeTikTokCode(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const code = typeof args.code === 'string' ? args.code.trim() : '';
  if (!code) return fail('Thiếu auth_code TikTok (mã ủy quyền từ Partner Center).');
  const res = await exchangeAuthCode({ appKey: platform.appKey, appSecret: platform.appSecret, authCode: code });
  if (!res.ok) {
    return fail(`Đổi mã ủy quyền TikTok thất bại (${res.error}). Mã auth_code chỉ dùng được 1 lần trong 30 phút — bấm "Kết nối TikTok" để lấy mã mới.`);
  }
  // Shop chưa từng kết nối thì tạo mới cấu hình token của shop (app chung đã có sẵn ở platform).
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  let cfg = tiktokCfgOf(state, sk);
  if (!cfg) { cfg = { status: 'disconnected' }; shop.tiktok = cfg; }
  cfg.accessToken = res.data.access_token;
  cfg.refreshToken = res.data.refresh_token;
  cfg.accessTokenExpiresAt = res.data.access_token_expire_in;
  cfg.refreshTokenExpiresAt = res.data.refresh_token_expire_in;
  cfg.grantedScopes = res.data.granted_scopes ?? [];
  cfg.chatScopeGranted = hasTikTokChatScope(cfg.grantedScopes);
  cfg.status = 'connected';
  cfg.connectedAt = new Date().toISOString();
  cfg.authExpiryWarning = undefined;
  // Phân giải shop (cipher) từ token vừa đổi.
  const shopsRes = await getAuthorizedShops({
    appKey: platform.appKey, appSecret: platform.appSecret,
    accessToken: res.data.access_token, apiVersion: platform.apiVersion || '202309',
  });
  if (shopsRes.ok && shopsRes.data.shops.length > 0) {
    const pick = (typeof args.shopId === 'string' && args.shopId)
      ? shopsRes.data.shops.find((s) => s.id === args.shopId) ?? shopsRes.data.shops[0]
      : shopsRes.data.shops[0];
    cfg.shopCipher = pick.cipher;
    cfg.shopId = pick.id;
    cfg.shopName = pick.name ?? cfg.shopName;
  } else if (typeof args.shopId === 'string' && args.shopId) {
    cfg.shopId = args.shopId;
  }
  return ok({
    shopKey: sk,
    shopName: cfg.shopName ?? null,
    shopId: cfg.shopId ?? null,
    grantedScopes: cfg.grantedScopes,
    chatScopeGranted: cfg.chatScopeGranted,
    accessTokenExpiresAt: cfg.accessTokenExpiresAt,
    status: cfg.status,
  });
}

async function hRefreshTikTokToken(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  return ok({ shopKey: sk, status: cfg.status, accessTokenExpiresAt: cfg.accessTokenExpiresAt ?? null });
}

function hDisconnectTikTok(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const cfg = tiktokCfgOf(state, sk);
  if (!cfg) return fail('Shop chưa kết nối TikTok.');
  // Chỉ xóa token của shop này — app TikTok chung của nền tảng không đụng tới.
  cfg.accessToken = '';
  cfg.refreshToken = '';
  cfg.shopCipher = '';
  cfg.shopId = '';
  cfg.shopName = '';
  cfg.grantedScopes = [];
  cfg.chatScopeGranted = false;
  cfg.status = 'disconnected';
  return ok({ shopKey: sk, status: 'disconnected' });
}

function hGetTikTokChannels(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  const cfg = shop?.tiktok;
  const platform = tiktokPlatformOf(state);
  const platformConfigured = tiktokPlatformConfigured(platform);
  const tiktokOrders = state.orders.filter((o) => o.shopKey === sk && (o as OrderExt).source === 'tiktok').length;
  const channels: Array<Record<string, unknown>> = [
    {
      id: 'tiktok',
      name: 'TikTok Shop',
      status: cfg?.status ?? 'disconnected',
      shopName: cfg?.shopName ?? null,
      shopId: cfg?.shopId ?? null,
      lastSyncAt: cfg?.lastSyncAt ?? null,
      lastSyncError: cfg?.lastSyncError ?? null,
      grantedScopes: cfg?.grantedScopes ?? [],
      chatScopeGranted: cfg?.chatScopeGranted ?? false,
      ordersCount: tiktokOrders,
      webhookUrl: platform.webhookUrl ?? '',
      redirectUri: platform.redirectUri ?? '',
      /** true = app TikTok chung đã được Super Admin cấu hình (shop chỉ cần bấm kết nối). */
      platformConfigured,
      hasConfig: platformConfigured,
    },
    {
      id: 'facebook',
      name: 'Facebook Messenger',
      status: (shop?.meta?.pages?.length ?? 0) > 0 ? 'connected' : 'disconnected',
      shopName: null,
      shopId: null,
      lastSyncAt: null,
      lastSyncError: null,
      grantedScopes: [],
      chatScopeGranted: false,
      ordersCount: state.orders.filter((o) => o.shopKey === sk && (o as OrderExt).source !== 'tiktok').length,
      webhookUrl: '',
      redirectUri: '',
      hasConfig: Boolean(shop?.meta?.appId),
      note: 'Quản lý ở màn Kết nối Meta (không phải ở đây).',
    },
  ];
  return ok({ shopKey: sk, channels });
}

async function hSyncTikTokOrders(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const E = extState(state);
  const skuMaps = E.tiktokSkuMaps.filter((m) => m.shopKey === sk);
  const variants = internalVariantsForShop(state, sk);
  const daysBack = Number(args.daysBack ?? 7) || 7;
  const maxOrders = Math.min(200, Math.max(1, Number(args.maxOrders ?? 50) || 50));
  const now = Math.floor(Date.now() / 1000);
  const lastSync = cfg.lastSyncAt ? Math.floor(new Date(cfg.lastSyncAt).getTime() / 1000) : 0;
  const updateGe = lastSync > 0 ? Math.max(lastSync - 3600, now - daysBack * 86400) : now - daysBack * 86400;
  const orderStatus = typeof args.orderStatus === 'string' && args.orderStatus ? args.orderStatus : undefined;
  let pageToken: string | undefined;
  let fetched = 0;
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const seen = new Set<string>();
  while (fetched < maxOrders) {
    const res = await searchOrders(base, {
      update_time_ge: updateGe,
      update_time_lt: now,
      ...(orderStatus ? { order_status: orderStatus } : {}),
    }, Math.min(100, maxOrders - fetched), pageToken);
    if (!res.ok) { errors.push(res.error); break; }
    const orders = res.data.orders ?? [];
    if (orders.length === 0) break;
    for (const summary of orders) {
      if (fetched >= maxOrders) break;
      if (seen.has(summary.id)) continue;
      seen.add(summary.id);
      fetched++;
      try {
        let detail = summary;
        if (!summary.line_items || summary.line_items.length === 0) {
          const d = await getOrderDetail(base, summary.id);
          if (!d.ok) { errors.push(`Đơn ${summary.id}: ${d.error}`); continue; }
          detail = d.data;
        }
        const up = upsertTikTokOrder(state, sk, detail, skuMaps, variants, 'tiktok-sync');
        const ext = up.order as OrderExt;
        ext.tiktokStatus = detail.status;
        ext.tiktokCurrency = detail.payment?.currency ?? 'VND';
        ext.tiktokMasked = tiktokIsMasked(detail.recipient_address?.name) || tiktokIsMasked(detail.recipient_address?.phone_number);
        ext.tiktokShopCipher = cfg.shopCipher ?? '';
        if (up.created) created++; else updated++;
      } catch (e) {
        errors.push(`Đơn ${summary.id}: ${String((e as Error)?.message ?? e)}`);
      }
    }
    pageToken = res.data.next_page_token;
    if (!pageToken) break;
  }
  cfg.lastSyncAt = new Date().toISOString();
  if (errors.length > 0) cfg.lastSyncError = errors[0];
  return ok({ shopKey: sk, fetched, created, updated, errors, lastSyncAt: cfg.lastSyncAt });
}

async function hGetTikTokProducts(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const E = extState(state);
  const pageSize = Math.min(100, Math.max(1, Number(args.pageSize ?? 20) || 20));
  const res = await searchProducts(base, {}, pageSize, typeof args.pageToken === 'string' ? args.pageToken : undefined);
  if (!res.ok) return fail(`Lấy sản phẩm TikTok thất bại: ${res.error}`);
  const products = (res.data.products ?? []).map((p) => ({
    id: p.id,
    name: p.title ?? p.id,
    status: p.status ?? '',
    skus: (p.skus ?? []).map((s) => {
      const map = E.tiktokSkuMaps.find((m) => m.shopKey === sk && m.skuId === s.id);
      return {
        id: s.id,
        sellerSku: s.seller_sku ?? '',
        price: s.price?.sale_price ?? null,
        currency: s.price?.currency ?? null,
        stock: (s.inventory ?? []).reduce((a, i) => a + (i.quantity ?? 0), 0),
        mappedInternalSku: map?.internalSku ?? null,
        mapId: map?.id ?? null,
      };
    }),
  }));
  return ok({ shopKey: sk, products, nextPageToken: res.data.next_page_token ?? null, total: res.data.total_count ?? products.length });
}

async function hSyncTikTokProducts(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const E = extState(state);
  const variants = internalVariantsForShop(state, sk);
  const applyStock = args.applyStock === true || args.applyStock === 'true';
  let pageToken: string | undefined;
  let fetched = 0;
  let matched = 0;
  let createdMaps = 0;
  let updatedMaps = 0;
  let stockUpdated = 0;
  const unmatched: string[] = [];
  while (fetched < 100) {
    const res = await searchProducts(base, {}, 50, pageToken);
    if (!res.ok) return fail(`Đồng bộ sản phẩm TikTok thất bại: ${res.error}`);
    const products = res.data.products ?? [];
    if (products.length === 0) break;
    for (const p of products) {
      fetched++;
      for (const s of p.skus ?? []) {
        const sellerSku = (s.seller_sku ?? '').trim();
        const stock = (s.inventory ?? []).reduce((a, i) => a + (i.quantity ?? 0), 0);
        const warehouseId = s.inventory?.[0]?.warehouse_id;
        if (!sellerSku) { unmatched.push(`${p.title ?? p.id} / ${s.id}`); continue; }
        const variant = variants.find((v) => v.sku.toLowerCase() === sellerSku.toLowerCase());
        if (!variant) { unmatched.push(sellerSku); continue; }
        matched++;
        let map = E.tiktokSkuMaps.find((m) => m.shopKey === sk && m.internalSku === variant.sku && m.skuId === s.id);
        if (!map) {
          map = {
            id: `tm-${sk}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            shopKey: sk,
            internalSku: variant.sku,
            productId: p.id,
            skuId: s.id,
            productName: p.title ?? '',
            skuName: sellerSku,
            tiktokStock: stock,
            warehouseId,
            syncedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
          E.tiktokSkuMaps.push(map);
          createdMaps++;
        } else {
          map.productName = p.title ?? '';
          map.skuName = sellerSku;
          map.tiktokStock = stock;
          if (warehouseId) map.warehouseId = warehouseId;
          map.syncedAt = new Date().toISOString();
          updatedMaps++;
        }
        if (applyStock && stock >= 0) {
          const found = findInternalVariant(state, sk, variant.sku);
          if (found && found.variant.stock !== stock) {
            found.variant.stock = stock;
            stockUpdated++;
          }
        }
      }
    }
    pageToken = res.data.next_page_token;
    if (!pageToken) break;
  }
  cfg.lastSyncAt = new Date().toISOString();
  return ok({
    shopKey: sk,
    fetchedProducts: fetched,
    matched,
    createdMaps,
    updatedMaps,
    stockUpdated,
    unmatched: unmatched.slice(0, 20),
    unmatchedCount: unmatched.length,
    lastSyncAt: cfg.lastSyncAt,
  });
}

function hMapTikTokSku(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const internalSku = String(args.internalSku ?? '').trim();
  const productId = String(args.productId ?? '').trim();
  const skuId = String(args.skuId ?? '').trim();
  if (!internalSku || !productId || !skuId) return fail('Thiếu internalSku / productId / skuId để map SKU TikTok.');
  const found = findInternalVariant(state, sk, internalSku);
  if (!found) return fail(`Không tìm thấy biến thể ${internalSku} trong catalogue của shop.`);
  const E = extState(state);
  let map = E.tiktokSkuMaps.find((m) => m.shopKey === sk && m.internalSku === internalSku && m.skuId === skuId);
  if (!map) {
    map = {
      id: `tm-${sk}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      shopKey: sk,
      internalSku,
      productId,
      skuId,
      productName: typeof args.productName === 'string' ? args.productName : '',
      skuName: typeof args.skuName === 'string' ? args.skuName : internalSku,
      syncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    E.tiktokSkuMaps.push(map);
  } else {
    map.productId = productId;
    if (typeof args.productName === 'string') map.productName = args.productName;
    if (typeof args.skuName === 'string') map.skuName = args.skuName;
    map.syncedAt = new Date().toISOString();
  }
  return ok({ shopKey: sk, map });
}

function hUnmapTikTokSku(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const E = extState(state);
  const before = E.tiktokSkuMaps.length;
  const id = typeof args.id === 'string' ? args.id : '';
  if (id) {
    E.tiktokSkuMaps = E.tiktokSkuMaps.filter((m) => !(m.shopKey === sk && m.id === id));
  } else {
    const internalSku = String(args.internalSku ?? '').trim();
    const skuId = String(args.skuId ?? '').trim();
    if (!internalSku && !skuId) return fail('Thiếu id hoặc internalSku/skuId để gỡ map.');
    E.tiktokSkuMaps = E.tiktokSkuMaps.filter((m) => !(m.shopKey === sk && (!internalSku || m.internalSku === internalSku) && (!skuId || m.skuId === skuId)));
  }
  return ok({ shopKey: sk, removed: before - E.tiktokSkuMaps.length });
}

async function hPushTikTokStock(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const E = extState(state);
  let targets = E.tiktokSkuMaps.filter((m) => m.shopKey === sk);
  if (typeof args.internalSku === 'string' && args.internalSku) targets = targets.filter((m) => m.internalSku === String(args.internalSku));
  if (typeof args.skuId === 'string' && args.skuId) targets = targets.filter((m) => m.skuId === String(args.skuId));
  if (typeof args.productId === 'string' && args.productId) targets = targets.filter((m) => m.productId === String(args.productId));
  if (targets.length === 0) return fail('Chưa có SKU nào được map TikTok (mở Kênh bán hàng → TikTok → Map SKU).');
  const mode = typeof args.mode === 'string' ? args.mode : 'both'; // 'stock' | 'price' | 'both'
  const byProduct = new Map<string, TikTokSkuMap[]>();
  for (const m of targets) {
    const list = byProduct.get(m.productId) ?? [];
    list.push(m);
    byProduct.set(m.productId, list);
  }
  const results: Array<{ productId: string; internalSku: string; skuId: string; kind: string; ok: boolean; error?: string }> = [];
  for (const [productId, list] of byProduct) {
    // Giá: 1 call / sản phẩm (giá lấy theo sản phẩm nội bộ — Variant không có giá riêng).
    if (mode === 'price' || mode === 'both') {
      const priceSkus: Array<{ id: string; price: { amount: string; currency: string } }> = [];
      for (const m of list) {
        const found = findInternalVariant(state, sk, m.internalSku);
        if (!found) { results.push({ productId, internalSku: m.internalSku, skuId: m.skuId, kind: 'price', ok: false, error: 'Không tìm thấy biến thể nội bộ.' }); continue; }
        priceSkus.push({ id: m.skuId, price: { amount: String(found.product.price), currency: 'VND' } });
      }
      if (priceSkus.length > 0) {
        const r = await updateProductPrices(base, productId, priceSkus);
        for (const ps of priceSkus) {
          const m = list.find((x) => x.skuId === ps.id)!;
          results.push({ productId, internalSku: m.internalSku, skuId: ps.id, kind: 'price', ok: r.ok, error: r.ok ? undefined : r.error });
        }
      }
    }
    // Tồn kho: 1 call / SKU (mỗi SKU có thể ở kho khác nhau).
    if (mode === 'stock' || mode === 'both') {
      for (const m of list) {
        const found = findInternalVariant(state, sk, m.internalSku);
        if (!found) { results.push({ productId, internalSku: m.internalSku, skuId: m.skuId, kind: 'stock', ok: false, error: 'Không tìm thấy biến thể nội bộ.' }); continue; }
        let warehouseId = m.warehouseId ?? (typeof args.warehouseId === 'string' ? args.warehouseId : undefined);
        if (!warehouseId) {
          // Lấy kho từ sản phẩm TikTok (SKU đầu tiên có inventory).
          const pd = await getProduct(base, productId);
          if (pd.ok) {
            const sku = (pd.data.skus ?? []).find((s) => s.id === m.skuId) ?? (pd.data.skus ?? [])[0];
            warehouseId = sku?.inventory?.[0]?.warehouse_id;
            if (warehouseId) m.warehouseId = warehouseId;
          }
        }
        if (!warehouseId) { results.push({ productId, internalSku: m.internalSku, skuId: m.skuId, kind: 'stock', ok: false, error: 'Chưa biết warehouse_id TikTok — đồng bộ sản phẩm trước để lấy kho.' }); continue; }
        const stock = Math.max(0, found.variant.stock);
        const r = await updateProductInventory(base, productId, [{ id: m.skuId, inventory: [{ warehouse_id: warehouseId, quantity: stock }] }]);
        if (r.ok) { m.tiktokStock = stock; m.syncedAt = new Date().toISOString(); }
        results.push({ productId, internalSku: m.internalSku, skuId: m.skuId, kind: 'stock', ok: r.ok, error: r.ok ? undefined : r.error });
      }
    }
  }
  return ok({ shopKey: sk, pushed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}

async function hSyncTikTokReturns(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const E = extState(state);
  const daysBack = Number(args.daysBack ?? 30) || 30;
  const now = Math.floor(Date.now() / 1000);
  const ge = now - daysBack * 86400;
  const res = await searchReturns(base, { update_time_ge: ge, update_time_lt: now }, 100);
  if (!res.ok) return fail(`Lấy danh sách hoàn/trả TikTok thất bại: ${res.error}`);
  const cres = await searchCancellations(base, { update_time_ge: ge, update_time_lt: now }, 100);
  const items: Array<{ kind: 'return' | 'cancellation'; raw: TikTokReturn }> = [
    ...(res.data.returns ?? []).map((r) => ({ kind: 'return' as const, raw: r })),
    ...((cres.ok ? cres.data.cancellations : []) ?? []).map((r) => ({ kind: 'cancellation' as const, raw: r })),
  ];
  let created = 0;
  let updated = 0;
  let slips = 0;
  const errors: string[] = [];
  if (!cres.ok) errors.push(`Hủy đơn: ${cres.error}`);
  for (const { kind, raw } of items) {
    const platformReturnId = raw.return_id ?? raw.id ?? '';
    const platformOrderId = raw.order_id;
    if (!platformReturnId || !platformOrderId) continue;
    const order = findOrderByTikTokId(state, sk, platformOrderId);
    const refund = tiktokMoneyObj(raw.refund_amount);
    const rec: TikTokReturnRecord = {
      id: `tr-${sk}-${platformReturnId}`,
      shopKey: sk,
      platformReturnId,
      platformOrderId,
      orderCode: order?.code ?? undefined,
      kind,
      status: raw.status ?? '',
      returnType: raw.return_type ?? undefined,
      reason: raw.reason ?? undefined,
      refundAmount: refund.amount || undefined,
      currency: refund.currency,
      at: raw.create_time ? new Date(raw.create_time * 1000).toISOString() : new Date().toISOString(),
      updatedAt: raw.update_time ? new Date(raw.update_time * 1000).toISOString() : new Date().toISOString(),
    };
    const existing = E.tiktokReturns.find((r) => r.shopKey === sk && r.platformReturnId === platformReturnId);
    if (existing) {
      Object.assign(existing, rec, { id: existing.id, returnSlipId: existing.returnSlipId });
      updated++;
    } else {
      E.tiktokReturns.push(rec);
      created++;
    }
    if (order) {
      let slip = E.returnSlips.find((s) => s.shopKey === sk && s.tiktokReturnId === platformReturnId);
      if (!slip) {
        slip = {
          id: uid('ret'),
          shopKey: sk,
          orderId: (order as OrderExt).id,
          orderCode: order.code,
          reason: `Hoàn/trả TikTok (${raw.return_type ?? kind}): ${raw.reason ?? ''}`.slice(0, 200),
          items: order.items,
          status: mapTikTokReturnStatus(raw.status ?? ''),
          at: nowIso(),
          by: ctxAccountId(ctx),
          tiktokReturnId: platformReturnId,
        };
        E.returnSlips.push(slip);
        slips++;
        const target = E.tiktokReturns.find((r) => r.shopKey === sk && r.platformReturnId === platformReturnId);
        if (target) target.returnSlipId = slip.id;
      }
      // Hoàn xong → đánh dấu đơn là hoàn hàng (không đụng đơn đã hủy).
      const done = /COMPLETE|SUCCESS|REFUNDED/i.test(raw.status ?? '');
      if (done && order.orderStatus !== 'hoan_hang' && order.orderStatus !== 'da_huy') {
        order.orderStatus = 'hoan_hang';
        const ext = order as unknown as Record<string, unknown>;
        const hist = (ext.history as Array<Record<string, unknown>> | undefined) ?? [];
        hist.push({ time: nowIso(), action: 'changeStatus', note: `Hoàn/trả TikTok ${platformReturnId} đã xử lý (${raw.status}).`, by: 'tiktok-sync' });
        ext.history = hist;
      }
    }
  }
  return ok({ shopKey: sk, returns: res.data.returns?.length ?? 0, cancellations: cres.ok ? (cres.data.cancellations?.length ?? 0) : 0, created, updated, slips, errors });
}

async function hApproveTikTokReturn(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const returnId = String(args.returnId ?? args.platformReturnId ?? '').trim();
  if (!returnId) return fail('Thiếu returnId TikTok.');
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const r = await approveReturn(base, returnId);
  if (!r.ok) return fail(`Duyệt hoàn TikTok thất bại: ${r.error}`);
  const E = extState(state);
  const rec = E.tiktokReturns.find((x) => x.shopKey === sk && x.platformReturnId === returnId);
  if (rec) { rec.status = 'APPROVED'; rec.updatedAt = new Date().toISOString(); }
  return ok({ shopKey: sk, returnId, approved: true });
}

async function hRejectTikTokReturn(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const returnId = String(args.returnId ?? args.platformReturnId ?? '').trim();
  if (!returnId) return fail('Thiếu returnId TikTok.');
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const r = await rejectReturn(base, returnId, typeof args.reason === 'string' ? args.reason : undefined);
  if (!r.ok) return fail(`Từ chối hoàn TikTok thất bại: ${r.error}`);
  const E = extState(state);
  const rec = E.tiktokReturns.find((x) => x.shopKey === sk && x.platformReturnId === returnId);
  if (rec) { rec.status = 'REJECTED'; rec.updatedAt = new Date().toISOString(); }
  return ok({ shopKey: sk, returnId, rejected: true });
}

async function hCalculateTikTokRefund(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const returnId = String(args.returnId ?? args.platformReturnId ?? '').trim();
  if (!returnId) return fail('Thiếu returnId TikTok.');
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const r = await calculateRefund(base, returnId);
  if (!r.ok) return fail(`Tính số tiền hoàn TikTok thất bại: ${r.error}`);
  return ok({ shopKey: sk, returnId, refund: r.data ?? null });
}

function upsertTikTokFinance(E: StateExtFull, sk: string, kind: TikTokFinanceRecord['kind'], platformId: string, patch: Partial<TikTokFinanceRecord>): void {
  const existing = E.tiktokFinance.find((r) => r.shopKey === sk && r.kind === kind && r.platformId === platformId);
  if (existing) {
    Object.assign(existing, patch);
  } else {
    E.tiktokFinance.push({ id: `tf-${sk}-${kind}-${platformId}`, shopKey: sk, kind, platformId, amount: 0, ...patch });
  }
}

async function hSyncTikTokFinance(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const E = extState(state);
  const daysBack = Number(args.daysBack ?? 30) || 30;
  const now = Math.floor(Date.now() / 1000);
  const ge = now - daysBack * 86400;
  const warnings: string[] = [];
  const sres = await listStatements(base, ge, now, 20);
  if (!sres.ok) return fail(`Lấy sao kê TikTok thất bại: ${sres.error}`);
  const statements = ((sres.data as Record<string, unknown>)?.statements ?? []) as Array<Record<string, unknown>>;
  let statementCount = 0;
  let transactionCount = 0;
  let withdrawalCount = 0;
  let matchedOrders = 0;
  const unmatchedOrderIds: string[] = [];
  for (const st of statements.slice(0, 5)) {
    const stId = String(st.statement_id ?? st.id ?? '');
    if (!stId) continue;
    const amt = tiktokMoneyObj(st.settlement_amount ?? st.amount);
    upsertTikTokFinance(E, sk, 'statement', stId, {
      amount: amt.amount,
      currency: amt.currency,
      status: typeof st.status === 'string' ? st.status : undefined,
      at: typeof st.settlement_date === 'string' ? st.settlement_date : (typeof st.create_time === 'number' ? new Date(st.create_time * 1000).toISOString() : undefined),
      raw: st,
    });
    statementCount++;
    const tres = await listStatementTransactions(base, stId, 50);
    if (!tres.ok) { warnings.push(`Sao kê ${stId}: ${tres.error}`); continue; }
    const txs = ((tres.data as Record<string, unknown>)?.statement_transactions ?? []) as Array<Record<string, unknown>>;
    for (const tx of txs) {
      const txId = String(tx.statement_transaction_id ?? tx.id ?? '');
      if (!txId) continue;
      const orderId = typeof tx.order_id === 'string' ? tx.order_id : undefined;
      const order = orderId ? findOrderByTikTokId(state, sk, orderId) : undefined;
      if (orderId && !order) unmatchedOrderIds.push(orderId);
      if (order) matchedOrders++;
      const tAmt = tiktokMoneyObj(tx.amount);
      const fees: Array<{ type: string; amount: number }> = [];
      if (Array.isArray(tx.fees)) {
        for (const f of tx.fees as Array<Record<string, unknown>>) {
          const fa = tiktokMoneyObj(f.amount);
          fees.push({ type: String(f.type ?? f.fee_type ?? 'fee'), amount: fa.amount });
        }
      }
      upsertTikTokFinance(E, sk, 'transaction', txId, {
        platformOrderId: orderId,
        orderCode: order?.code,
        amount: tAmt.amount,
        currency: tAmt.currency,
        fees: fees.length ? fees : undefined,
        status: typeof tx.status === 'string' ? tx.status : undefined,
        at: typeof tx.create_time === 'number' ? new Date(tx.create_time * 1000).toISOString() : undefined,
        raw: tx,
      });
      transactionCount++;
    }
  }
  const wres = await listWithdrawals(base, ge, now, 20);
  if (wres.ok) {
    const ws = ((wres.data as Record<string, unknown>)?.withdrawals ?? []) as Array<Record<string, unknown>>;
    for (const w of ws) {
      const wId = String(w.withdrawal_id ?? w.id ?? '');
      if (!wId) continue;
      const wAmt = tiktokMoneyObj(w.amount);
      upsertTikTokFinance(E, sk, 'withdrawal', wId, {
        amount: wAmt.amount,
        currency: wAmt.currency,
        status: typeof w.status === 'string' ? w.status : undefined,
        at: typeof w.create_time === 'number' ? new Date(w.create_time * 1000).toISOString() : undefined,
        raw: w,
      });
      withdrawalCount++;
    }
  } else {
    warnings.push(`Rút tiền: ${wres.error}`);
  }
  const pres = await listPayments(base, ge, now, 20);
  if (!pres.ok) {
    warnings.push(`Payments API: ${pres.error} (TikTok không mở Payments ở Đông Nam Á — đối soát bằng sao kê).`);
  }
  return ok({
    shopKey: sk,
    statements: statementCount,
    transactions: transactionCount,
    withdrawals: withdrawalCount,
    matchedOrders,
    unmatchedOrderIds: [...new Set(unmatchedOrderIds)].slice(0, 20),
    warnings,
  });
}

/**
 * Nhận webhook TikTok: verify chữ ký + dedupe + lưu event (CHƯA xử lý).
 * Route /webhook/tiktok gọi hàm này rồi trả 200 ngay, xử lý chạy nền qua
 * processStoredTikTokWebhookEvent. Action tiktokwebhookreceive gọi cả hai.
 */
export async function handleTikTokWebhook(state: State, opts: {
  rawBody: string | Buffer;
  authorization?: string | null;
  xTtsSignature?: string | null;
  xTtsTimestamp?: string | null;
  shopKey?: string;
}): Promise<ActionResult> {
  const raw = typeof opts.rawBody === 'string' ? opts.rawBody : opts.rawBody.toString('utf8');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail('Webhook TikTok không phải JSON hợp lệ.');
  }
  const shopId = body.shop_id != null ? String(body.shop_id) : '';
  let shop = shopId ? state.shops.find((s) => (s as ShopExt).tiktok?.shopId === shopId) : undefined;
  if (!shop && opts.shopKey) shop = state.shops.find((s) => s.key === opts.shopKey);
  if (!shop) return fail(shopId ? `Không tìm thấy shop TikTok cho shop_id ${shopId} (shop chưa kết nối TikTok?).` : 'Webhook TikTok thiếu shop_id.');
  // Chữ ký webhook verify bằng app_secret của app CHUNG (mọi shop dùng chung 1 app).
  const platform = tiktokPlatformOf(state);
  if (!tiktokPlatformConfigured(platform)) return fail('App TikTok chung chưa được cấu hình — không verify được chữ ký webhook.');
  const sigOk = verifyTikTokWebhookSignature(platform.appKey, platform.appSecret, raw, opts.authorization ?? null, opts.xTtsSignature ?? null, opts.xTtsTimestamp ?? null);
  if (!sigOk) return fail('Chữ ký webhook TikTok không hợp lệ (sai app_secret của app chung hoặc body bị sửa).');
  const E = extState(state);
  const key = tiktokWebhookDedupeKey(raw);
  if (E.tiktokWebhookEvents.some((e) => e.dedupeKey === key)) return ok({ duplicate: true, note: 'Event đã nhận trước đó.' });
  const data = (body.data ?? {}) as Record<string, unknown>;
  const event: TikTokWebhookEvent = {
    id: `tw-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    shopKey: shop.key,
    dedupeKey: key,
    eventType: String(body.type ?? 'UNKNOWN'),
    shopId: shopId || undefined,
    platformOrderId: typeof data.order_id === 'string' ? data.order_id : undefined,
    receivedAt: new Date().toISOString(),
    status: 'stored',
    payload: body,
  };
  E.tiktokWebhookEvents.push(event);
  return ok({ eventId: event.id, eventType: event.eventType, shopKey: shop.key, duplicate: false });
}

/** Xử lý 1 event webhook đã lưu (gọi API lấy chi tiết đơn khi cần). */
export async function processStoredTikTokWebhookEvent(state: State, eventId: string): Promise<{ processed: boolean; note: string; orderCode?: string }> {
  const E = extState(state);
  const event = E.tiktokWebhookEvents.find((e) => e.id === eventId);
  if (!event) return { processed: false, note: 'Không tìm thấy event webhook.' };
  const sk = event.shopKey;
  const cfg = tiktokCfgOf(state, sk);
  if (!cfg) { event.status = 'failed'; event.note = 'Shop không còn cấu hình TikTok.'; return { processed: false, note: event.note }; }
  const type = event.eventType;
  try {
    if (type === 'SELLER_DEAUTHORIZATION') {
      cfg.accessToken = ''; cfg.refreshToken = ''; cfg.shopCipher = ''; cfg.shopId = ''; cfg.shopName = ''; cfg.status = 'revoked';
      event.status = 'processed'; event.note = 'Shop đã hủy ủy quyền TikTok — token đã xóa, cần kết nối lại.';
      return { processed: true, note: event.note };
    }
    if (type === 'ORDER_STATUS_CHANGE' || type === 'ORDER_STATUS_UPDATE' || type === 'PACKAGE_UPDATE' || type === 'RECIPIENT_ADDRESS_UPDATE') {
      const orderId = event.platformOrderId;
      if (!orderId) { event.status = 'failed'; event.note = 'Event thiếu order_id.'; return { processed: false, note: event.note }; }
      const token = await ensureTikTokAccessToken(state, sk);
      if (typeof token !== 'string') { const errMsg = token.error ?? 'Lỗi token TikTok.'; event.status = 'failed'; event.note = errMsg; return { processed: false, note: errMsg }; }
      const base = tiktokBaseCall(tiktokPlatformOf(state), cfg, token);
      const d = await getOrderDetail(base, orderId);
      if (!d.ok) { event.status = 'failed'; event.note = `Lấy chi tiết đơn ${orderId} thất bại: ${d.error}`; return { processed: false, note: event.note }; }
      const skuMaps = E.tiktokSkuMaps.filter((m) => m.shopKey === sk);
      const variants = internalVariantsForShop(state, sk);
      const up = upsertTikTokOrder(state, sk, d.data, skuMaps, variants, 'tiktok-webhook');
      const ext = up.order as OrderExt;
      ext.tiktokStatus = d.data.status;
      ext.tiktokCurrency = d.data.payment?.currency ?? 'VND';
      ext.tiktokMasked = tiktokIsMasked(d.data.recipient_address?.name) || tiktokIsMasked(d.data.recipient_address?.phone_number);
      ext.tiktokShopCipher = cfg.shopCipher ?? '';
      if (type === 'RECIPIENT_ADDRESS_UPDATE') {
        const input = mapTikTokOrderToOrderInput(d.data, skuMaps, variants);
        ext.customerName = input.customerName;
        ext.customerPhone = input.customerPhone;
        ext.customerAddress = input.customerAddress;
      }
      event.status = 'processed';
      event.note = `Đơn ${up.order.code} (${up.created ? 'mới' : 'cập nhật'}) — trạng thái TikTok ${d.data.status}.`;
      return { processed: true, note: event.note, orderCode: up.order.code };
    }
    if (type === 'PRODUCT_STATUS_CHANGE') {
      event.status = 'processed'; event.note = 'Trạng thái sản phẩm TikTok thay đổi — xem lại trong Seller Center / đồng bộ sản phẩm.';
      return { processed: true, note: event.note };
    }
    if (type === 'AUTHORIZATION_EXPIRY' || type === 'AUTHORIZATION_EXPIRING') {
      cfg.authExpiryWarning = 'Token TikTok sắp hết hạn — sẽ tự làm mới khi đồng bộ; nếu thất bại cần kết nối lại.';
      event.status = 'processed'; event.note = cfg.authExpiryWarning;
      return { processed: true, note: event.note };
    }
    if (type === 'NEW_MESSAGE') {
      event.status = 'processed'; event.note = 'Tin nhắn mới từ khách TikTok — xem trong Seller Center; trả lời qua sendtiktokmessage nếu scope chat đã được cấp.';
      return { processed: true, note: event.note };
    }
    event.status = 'ignored'; event.note = `Type webhook chưa hỗ trợ (${type}) — đã lưu event để xem lại.`;
    return { processed: false, note: event.note };
  } catch (e) {
    event.status = 'failed'; event.note = String((e as Error)?.message ?? e);
    return { processed: false, note: event.note };
  }
}

async function hTikTokWebhookReceive(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const rawBody = typeof args.rawBody === 'string' ? args.rawBody : '';
  if (!rawBody) return fail('Thiếu rawBody webhook TikTok.');
  const handled = await handleTikTokWebhook(state, {
    rawBody,
    authorization: typeof args.authorization === 'string' ? args.authorization : null,
    xTtsSignature: typeof args.xTtsSignature === 'string' ? args.xTtsSignature : null,
    xTtsTimestamp: typeof args.xTtsTimestamp === 'string' ? args.xTtsTimestamp : null,
    shopKey: typeof args.shopKey === 'string' ? args.shopKey : undefined,
  });
  if (!handled.ok) return handled;
  if (handled.duplicate) return ok({ duplicate: true, note: 'Event đã nhận trước đó.' });
  const eventId = String(handled.eventId ?? '');
  const processed = await processStoredTikTokWebhookEvent(state, eventId);
  return ok({ eventId, eventType: handled.eventType, shopKey: handled.shopKey, ...processed });
}

async function hTikTokPoll(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const orders = await hSyncTikTokOrders(state, ctx, { ...args, daysBack: 1, maxOrders: 50 });
  const returns = await hSyncTikTokReturns(state, ctx, { ...args, daysBack: 1 });
  let finance: ActionResult | null = null;
  if (args.finance === true || args.finance === 'true') {
    finance = await hSyncTikTokFinance(state, ctx, { ...args, daysBack: 1 });
  }
  return ok({ shopKey: sk, orders, returns, finance, polledAt: new Date().toISOString() });
}

async function hSendTikTokMessage(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const cfg = tiktokCfgOf(state, sk);
  if (!cfg?.chatScopeGranted && !hasTikTokChatScope(cfg?.grantedScopes)) {
    return fail('TikTok chưa cấp quyền nhắn tin khách (Customer Service). Scope này TikTok cấp theo yêu cầu — xem trong Partner Center → App → Scopes. Khách vẫn xem được tin nhắn trong Seller Center.');
  }
  const conversationId = String(args.conversationId ?? '').trim();
  const text = String(args.text ?? '').trim();
  if (!conversationId || !text) return fail('Thiếu conversationId hoặc nội dung tin nhắn.');
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const base = tiktokBaseCall(platform, tiktokCfgOf(state, sk)!, token);
  const res = await sendCustomerServiceMessage(base, conversationId, text);
  const E = extState(state);
  const msg: TikTokMessage = {
    id: `tmsg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    shopKey: sk,
    conversationId,
    text,
    at: new Date().toISOString(),
    by: ctxAccountId(ctx),
    status: res.ok ? 'sent' : 'failed',
    error: res.ok ? undefined : res.error,
  };
  E.tiktokMessages.push(msg);
  if (!res.ok) return fail(`Gửi tin nhắn TikTok thất bại: ${res.error}`);
  return ok({ shopKey: sk, messageId: msg.id, status: 'sent' });
}

async function hRegisterTikTokWebhook(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireTikTokPlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  if (!platform.webhookUrl) return fail('Chưa nhập Webhook URL cho app TikTok chung (Super Admin → App TikTok chung).');
  const token = await ensureTikTokAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = tiktokCfgOf(state, sk)!;
  const base = tiktokBaseCall(platform, cfg, token);
  const eventTypes = Array.isArray(args.eventTypes) && args.eventTypes.length > 0
    ? (args.eventTypes as unknown[]).map(String)
    : ['ORDER_STATUS_CHANGE', 'ORDER_STATUS_UPDATE', 'PACKAGE_UPDATE', 'RECIPIENT_ADDRESS_UPDATE', 'PRODUCT_STATUS_CHANGE', 'SELLER_DEAUTHORIZATION', 'NEW_MESSAGE'];
  const results: Array<{ eventType: string; ok: boolean; error?: string }> = [];
  for (const t of eventTypes) {
    const r = await registerWebhook(base, t, platform.webhookUrl);
    results.push({ eventType: t, ok: r.ok, error: r.ok ? undefined : r.error });
  }
  return ok({ shopKey: sk, webhookUrl: platform.webhookUrl, registered: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}

// ---------------------------------------------------------------------------
// Shopee (Open Platform API v2 — app ISV chung, mô hình Achat)
// ---------------------------------------------------------------------------

function shopeeCfgOf(state: State, sk: string): ShopeeShopConfig | null {
  const shop = getShop(state, sk) as ShopExt | undefined;
  return shop?.shopee ?? null;
}

/**
 * App Shopee CHUNG của nền tảng (mô hình Achat — 1 app ISV, mọi shop chỉ
 * ủy quyền). State cũ chưa có trường này thì loadState đã gộp mặc định rỗng.
 */
function shopeePlatformOf(state: State): ShopeePlatformConfig {
  return state.shopeePlatform ?? {
    partnerId: '', partnerKey: '', redirectUri: '', webhookUrl: '', apiHost: '', sandbox: false,
  };
}

function requireShopeePlatform(state: State): ShopeePlatformConfig | ActionResult {
  const platform = shopeePlatformOf(state);
  if (!shopeePlatformConfigured(platform)) {
    return fail('App Shopee chung của AChatGo chưa được cấu hình (cần partner_id, partner_key của app ISV chung). Chỉ Super Admin mới nhập được — mở Super Admin → App Shopee chung. App đăng ký tại open.shopee.com (cần giấy tờ doanh nghiệp, duyệt ~10 ngày làm việc).');
  }
  return platform;
}

/** Access token còn hạn; tự refresh khi sắp hết (còn < 10 phút). Trả fail khi chưa kết nối / refresh lỗi. */
async function ensureShopeeAccessToken(state: State, sk: string): Promise<string | ActionResult> {
  const platform = shopeePlatformOf(state);
  const cfg = shopeeCfgOf(state, sk);
  if (!shopeePlatformConfigured(platform)) return fail('App Shopee chung của AChatGo chưa được cấu hình. Liên hệ Super Admin để nhập app chung trước.');
  if (!cfg?.accessToken || !cfg?.refreshToken) return fail('Shopee chưa kết nối (chưa có access token). Bấm "Kết nối Shopee" để ủy quyền.');
  const nowMs = Date.now();
  if (cfg.refreshTokenExpiresAt && Date.parse(cfg.refreshTokenExpiresAt) <= nowMs) {
    cfg.status = 'expired';
    return fail('Refresh token Shopee đã hết hạn (30 ngày). Cần bấm "Kết nối Shopee" để ủy quyền lại.');
  }
  const expiringSoon = cfg.accessTokenExpiresAt ? Date.parse(cfg.accessTokenExpiresAt) - nowMs < 10 * 60 * 1000 : true;
  if (!expiringSoon) return cfg.accessToken;
  const host = shopeeHostOf(platform);
  const res = await refreshShopeeAccessToken({
    partnerId: platform.partnerId, partnerKey: platform.partnerKey,
    refreshToken: cfg.refreshToken, shopId: cfg.shopId ?? '', host,
  });
  if (!res.ok) {
    cfg.status = 'expired';
    return fail(`Không làm mới được access token Shopee (${res.error}). Cần kết nối lại Shopee.`);
  }
  cfg.accessToken = res.data.accessToken;
  cfg.refreshToken = res.data.refreshToken;
  cfg.accessTokenExpiresAt = new Date(nowMs + res.data.expireIn * 1000).toISOString();
  cfg.refreshTokenExpiresAt = new Date(nowMs + SHOPEE_REFRESH_TOKEN_TTL_DAYS * 86400000).toISOString();
  cfg.status = 'connected';
  return cfg.accessToken;
}

/** Call Shopee có ký (shop-level): credential lấy từ app chung, token/shop lấy từ shop. */
function shopeeBaseCall(platform: ShopeePlatformConfig, cfg: ShopeeShopConfig, accessToken: string): ShopeeCall {
  return {
    partnerId: platform.partnerId,
    partnerKey: platform.partnerKey,
    accessToken,
    shopId: cfg.shopId ?? '',
    host: shopeeHostOf(platform),
  };
}

function invalidShopeeUrlError(): string {
  return 'Địa chỉ phải là URL web thật bắt đầu bằng https:// và không chứa phần query/fragment. Đăng ký đúng địa chỉ này trong Shopee Open Platform console (mục App → URLs) trước khi kết nối.';
}

/** URL Shopee (redirect/webhook): https bắt buộc; cho phép http://localhost để test local. Không query/fragment. */
function isValidShopeeUrl(uri: string): boolean {
  if (!uri) return false;
  try {
    const parsed = new URL(uri.trim());
    if (parsed.search || parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Lưu app Shopee CHUNG (mô hình Achat) — CHỈ Super Admin. Partner Key chỉ
 * ghi đè khi nhập giá trị mới (UI để trống = giữ nguyên, key không bao giờ
 * hiện lại; đổi key thì ghi lại thời điểm tạo để nhắc reset sau 180 ngày).
 * Đổi partner_id = token các shop đã ủy quyền dưới app cũ mất hiệu lực →
 * xóa token toàn bộ shop, các shop bấm "Kết nối Shopee" để ủy quyền lại
 * dưới app chung mới.
 */
function hSaveShopeePlatformConfig(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  const body = (args.config ?? args) as Record<string, unknown>;
  const prev = shopeePlatformOf(state);
  const redirectUri = typeof body.redirectUri === 'string' && body.redirectUri.trim() ? body.redirectUri.trim() : prev.redirectUri ?? '';
  const webhookUrl = typeof body.webhookUrl === 'string' && body.webhookUrl.trim() ? body.webhookUrl.trim() : prev.webhookUrl ?? '';
  if (redirectUri && !isValidShopeeUrl(redirectUri)) return fail(invalidShopeeUrlError());
  if (webhookUrl && !isValidShopeeUrl(webhookUrl)) return fail(invalidShopeeUrlError());
  const partnerId = typeof body.partnerId === 'string' && body.partnerId.trim() ? body.partnerId.trim() : prev.partnerId;
  const partnerKeyChanged = typeof body.partnerKey === 'string' && body.partnerKey.trim() ? body.partnerKey.trim() !== prev.partnerKey : false;
  const credsChanged = (partnerId && partnerId !== prev.partnerId);
  const platform: ShopeePlatformConfig = {
    partnerId,
    // partner_key chỉ ghi đè khi nhập giá trị mới (UI để trống = giữ nguyên).
    partnerKey: typeof body.partnerKey === 'string' && body.partnerKey.trim() ? body.partnerKey.trim() : prev.partnerKey,
    redirectUri,
    webhookUrl,
    apiHost: typeof body.apiHost === 'string' && body.apiHost.trim() ? body.apiHost.trim() : prev.apiHost,
    sandbox: body.sandbox === true || body.sandbox === 'true' ? true : body.sandbox === false || body.sandbox === 'false' ? false : Boolean(prev.sandbox),
    partnerKeyCreatedAt: partnerKeyChanged ? new Date().toISOString() : prev.partnerKeyCreatedAt,
    updatedAt: new Date().toISOString(),
  };
  state.shopeePlatform = platform;
  if (credsChanged) {
    // Token các shop phát hành dưới app cũ → mất hiệu lực, phải ủy quyền lại.
    for (const shop of state.shops) {
      const s = (shop as ShopExt).shopee;
      if (!s) continue;
      s.accessToken = '';
      s.refreshToken = '';
      s.shopId = '';
      s.shopName = '';
      s.status = 'disconnected';
    }
  }
  return ok({ platform: shopeePlatformPublic(platform), tokensCleared: credsChanged, partnerKeyResetDate: shopeePartnerKeyResetDate(platform) });
}

/** Đọc app Shopee chung — CHỈ Super Admin (partnerKey không bao giờ trả về). */
function hGetShopeePlatformConfig(state: State, ctx: ActionContext, _args: Record<string, any>): ActionResult {
  const no = requireSuperAdmin(ctx);
  if (no) return no;
  const platform = shopeePlatformOf(state);
  return ok({ platform: shopeePlatformPublic(platform), partnerKeyResetDate: shopeePartnerKeyResetDate(platform) });
}

function hGetShopeeOAuthUrl(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  if (!platform.redirectUri) return fail('Chưa nhập Redirect URI cho app Shopee chung. Redirect URI phải khớp đúng địa chỉ đã đăng ký trong Shopee Open Platform console (Super Admin → App Shopee chung).');
  // Shopee auth_partner KHÔNG hỗ trợ state — pending 10 phút để callback
  // biết shop nào đang kết nối; đang có pending khác thì từ chối.
  const pending = createShopeeAuthState(sk);
  if (!pending.ok) return fail(pending.error ?? 'Đang có shop khác kết nối Shopee.');
  const url = buildShopeeAuthorizeUrl({
    partnerId: platform.partnerId,
    partnerKey: platform.partnerKey,
    redirectUri: platform.redirectUri,
    host: shopeeHostOf(platform),
  });
  return ok({ shopKey: sk, url });
}

async function hExchangeShopeeCode(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const code = typeof args.code === 'string' ? args.code.trim() : '';
  const shopId = typeof args.shopId === 'string' ? args.shopId.trim() : '';
  if (!code) return fail('Thiếu code Shopee (mã ủy quyền từ Shopee).');
  if (!shopId) return fail('Thiếu shop_id Shopee (Shopee không trả shop_id trong callback).');
  const nowMs = Date.now();
  const res = await exchangeShopeeAuthCode({
    partnerId: platform.partnerId, partnerKey: platform.partnerKey,
    code, shopId, host: shopeeHostOf(platform),
  });
  if (!res.ok) {
    return fail(`Đổi mã ủy quyền Shopee thất bại (${res.error}). Code chỉ dùng được 1 lần trong 10 phút — bấm "Kết nối Shopee" để lấy mã mới.`);
  }
  // Shop chưa từng kết nối thì tạo mới cấu hình token của shop (app chung đã có sẵn ở platform).
  const shop = getShop(state, sk) as ShopExt | undefined;
  if (!shop) return fail('Không tìm thấy shop.');
  let cfg = shopeeCfgOf(state, sk);
  if (!cfg) { cfg = { status: 'disconnected' }; shop.shopee = cfg; }
  cfg.accessToken = res.data.accessToken;
  cfg.refreshToken = res.data.refreshToken;
  cfg.accessTokenExpiresAt = new Date(nowMs + res.data.expireIn * 1000).toISOString();
  cfg.refreshTokenExpiresAt = new Date(nowMs + SHOPEE_REFRESH_TOKEN_TTL_DAYS * 86400000).toISOString();
  cfg.shopId = shopId;
  cfg.status = 'connected';
  cfg.connectedAt = new Date().toISOString();
  cfg.authExpiryWarning = undefined;
  // Hạn ủy quyền TỐI ĐA 1 năm (seller chọn 7–365 ngày lúc ủy quyền nên hạn
  // thật có thể sớm hơn; Shopee báo trước 7 ngày qua push code 12).
  cfg.authExpiresAt = new Date(nowMs + SHOPEE_AUTH_MAX_DAYS * 86400000).toISOString();
  // Lấy tên shop Shopee để hiển thị + kiểm chứng.
  const info = await getShopeeShopInfo(shopeeBaseCall(platform, cfg, cfg.accessToken));
  if (info.ok && info.data.shop_name) cfg.shopName = info.data.shop_name;
  return ok({
    shopKey: sk,
    shopName: cfg.shopName ?? null,
    shopId: cfg.shopId ?? null,
    accessTokenExpiresAt: cfg.accessTokenExpiresAt,
    authExpiresAt: cfg.authExpiresAt,
    status: cfg.status,
  });
}

async function hRefreshShopeeToken(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  return ok({ shopKey: sk, status: cfg.status, accessTokenExpiresAt: cfg.accessTokenExpiresAt ?? null });
}

function hDisconnectShopee(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const cfg = shopeeCfgOf(state, sk);
  if (!cfg) return fail('Shop chưa kết nối Shopee.');
  // Chỉ xóa token của shop này — app Shopee chung của nền tảng không đụng tới.
  cfg.accessToken = '';
  cfg.refreshToken = '';
  cfg.shopId = '';
  cfg.shopName = '';
  cfg.status = 'disconnected';
  return ok({ shopKey: sk, status: 'disconnected' });
}

function hGetShopeeChannels(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const shop = getShop(state, sk) as ShopExt | undefined;
  const cfg = shop?.shopee;
  const platform = shopeePlatformOf(state);
  const platformConfigured = shopeePlatformConfigured(platform);
  const shopeeOrders = state.orders.filter((o) => o.shopKey === sk && (o as OrderExt).source === 'shopee').length;
  const pub = shopeePlatformPublic(platform);
  const channels: Array<Record<string, unknown>> = [
    {
      id: 'shopee',
      name: 'Shopee',
      status: cfg?.status ?? 'disconnected',
      shopName: cfg?.shopName ?? null,
      shopId: cfg?.shopId ?? null,
      lastSyncAt: cfg?.lastSyncAt ?? null,
      lastSyncError: cfg?.lastSyncError ?? null,
      accessTokenExpiresAt: cfg?.accessTokenExpiresAt ?? null,
      authExpiresAt: cfg?.authExpiresAt ?? null,
      authExpiryWarning: cfg?.authExpiryWarning ?? false,
      ordersCount: shopeeOrders,
      webhookUrl: platform.webhookUrl ?? '',
      redirectUri: platform.redirectUri ?? '',
      /** true = app Shopee chung đã được Super Admin cấu hình (shop chỉ cần bấm kết nối). */
      platformConfigured,
      hasConfig: platformConfigured,
      sandbox: Boolean(platform.sandbox),
      partnerKeyResetDue: pub.partnerKeyResetDue ?? false,
      partnerKeyAgeDays: pub.partnerKeyAgeDays ?? null,
      /** Chat API Shopee đã đóng với app bên thứ 3 mới (18/11/2024) — KHÔNG nhắn tin qua app. */
      chatSupported: false,
      chatNote: 'Shopee đóng Chat API với app mới từ 18/11/2024 — tin nhắn khách Shopee trả lời tay trong Seller Center.',
      /** SĐT/địa chỉ khách mặc định bị che — cần quyền sensitive-data riêng mới lấy thật. */
      maskedNote: 'SĐT/địa chỉ khách Shopee mặc định bị che — đơn import vẫn giao được qua logistics Shopee, muốn lấy thông tin thật cần xin quyền sensitive-data trong console.',
    },
    {
      id: 'facebook',
      name: 'Facebook Messenger',
      status: (shop?.meta?.pages?.length ?? 0) > 0 ? 'connected' : 'disconnected',
      shopName: null,
      shopId: null,
      lastSyncAt: null,
      lastSyncError: null,
      grantedScopes: [],
      chatScopeGranted: false,
      ordersCount: state.orders.filter((o) => o.shopKey === sk && (o as OrderExt).source !== 'shopee').length,
      webhookUrl: '',
      redirectUri: '',
      hasConfig: Boolean(shop?.meta?.appId),
      note: 'Quản lý ở màn Kết nối Meta (không phải ở đây).',
    },
  ];
  return ok({ shopKey: sk, channels });
}

/** Liệt kê sản phẩm Shopee của shop (kèm model + map SKU nội bộ). */
async function hGetShopeeProducts(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const E = extState(state);
  const pageSize = Math.min(100, Math.max(1, Number(args.pageSize ?? 20) || 20));
  const offset = Math.max(0, Number(args.offset ?? 0) || 0);
  const listRes = await getShopeeItemList(call, { offset, pageSize, itemStatus: typeof args.itemStatus === 'string' ? args.itemStatus : undefined });
  if (!listRes.ok) return fail(`Lấy danh sách sản phẩm Shopee thất bại: ${listRes.error}`);
  const ids = (listRes.data.item ?? []).map((i) => i.item_id);
  const products: Array<Record<string, unknown>> = [];
  if (ids.length > 0) {
    const baseRes = await getShopeeItemBaseInfo(call, ids);
    if (!baseRes.ok) return fail(`Lấy chi tiết sản phẩm Shopee thất bại: ${baseRes.error}`);
    for (const p of baseRes.data.item_list ?? []) {
      const models: Array<Record<string, unknown>> = [];
      const mRes = await getShopeeModelList(call, p.item_id);
      const modelList: ShopeeModel[] = mRes.ok ? (mRes.data.model ?? []) : [];
      if (modelList.length > 0) {
        for (const m of modelList) {
          const map = E.shopeeSkuMaps.find((x) => x.shopKey === sk && x.itemId === String(p.item_id) && x.modelId === String(m.model_id));
          models.push({
            id: String(m.model_id),
            modelSku: m.model_sku ?? '',
            modelName: m.model_name ?? '',
            price: m.price_info?.[0]?.original_price ?? null,
            stock: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
            mappedInternalSku: map?.internalSku ?? null,
            mapId: map?.id ?? null,
          });
        }
      } else {
        // Item không có model: map chính item đó (modelId '').
        const map = E.shopeeSkuMaps.find((x) => x.shopKey === sk && x.itemId === String(p.item_id) && !x.modelId);
        models.push({
          id: '',
          modelSku: p.item_sku ?? '',
          modelName: p.item_name ?? '',
          price: p.price_info?.[0]?.original_price ?? null,
          stock: p.stock_info_v2?.summary_info?.total_available_stock ?? null,
          mappedInternalSku: map?.internalSku ?? null,
          mapId: map?.id ?? null,
        });
      }
      products.push({
        id: String(p.item_id),
        name: p.item_name ?? String(p.item_id),
        status: p.item_status ?? '',
        itemSku: p.item_sku ?? '',
        skus: models,
      });
    }
  }
  return ok({ shopKey: sk, products, total: listRes.data.total_count ?? products.length, offset, pageSize });
}

async function hSyncShopeeProducts(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const E = extState(state);
  const variants = internalVariantsForShop(state, sk);
  const applyStock = args.applyStock === true || args.applyStock === 'true';
  const maxItems = Math.min(500, Math.max(1, Number(args.maxItems ?? 200) || 200));
  let offset = 0;
  let fetched = 0;
  let matched = 0;
  let createdMaps = 0;
  let updatedMaps = 0;
  let stockUpdated = 0;
  const unmatched: string[] = [];
  const errors: string[] = [];
  while (fetched < maxItems) {
    const listRes = await getShopeeItemList(call, { offset, pageSize: Math.min(100, maxItems - fetched) });
    if (!listRes.ok) return fail(`Đồng bộ sản phẩm Shopee thất bại: ${listRes.error}`);
    const items = listRes.data.item ?? [];
    if (items.length === 0) break;
    offset += items.length;
    // get_item_base_info tối đa 50 item/lần.
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      const baseRes = await getShopeeItemBaseInfo(call, batch.map((x) => x.item_id));
      if (!baseRes.ok) { errors.push(baseRes.error); continue; }
      for (const p of baseRes.data.item_list ?? []) {
        fetched++;
        const mRes = await getShopeeModelList(call, p.item_id);
        const modelList: ShopeeModel[] = mRes.ok ? (mRes.data.model ?? []) : [];
        // Item không có model vẫn có 1 model mặc định — map chính item đó.
        const entries: Array<{ modelId: string; modelSku: string; modelName: string; price?: number; stock?: number }> =
          modelList.length > 0
            ? modelList.map((m) => ({
                modelId: String(m.model_id),
                modelSku: m.model_sku ?? '',
                modelName: m.model_name ?? '',
                price: m.price_info?.[0]?.original_price,
                stock: m.stock_info_v2?.summary_info?.total_available_stock,
              }))
            : [{
                modelId: '',
                modelSku: p.item_sku ?? '',
                modelName: p.item_name ?? '',
                price: p.price_info?.[0]?.original_price,
                stock: p.stock_info_v2?.summary_info?.total_available_stock,
              }];
        for (const entry of entries) {
          const sellerSku = (entry.modelSku || '').trim();
          if (!sellerSku) { unmatched.push(`${p.item_name ?? p.item_id} / ${entry.modelId || 'item'}`); continue; }
          const variant = variants.find((v) => v.sku.toLowerCase() === sellerSku.toLowerCase());
          if (!variant) { unmatched.push(sellerSku); continue; }
          matched++;
          let map = E.shopeeSkuMaps.find((m) => m.shopKey === sk && m.internalSku === variant.sku && m.itemId === String(p.item_id) && m.modelId === entry.modelId);
          if (!map) {
            map = {
              id: `sm-${sk}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              shopKey: sk,
              internalSku: variant.sku,
              itemId: String(p.item_id),
              modelId: entry.modelId,
              productName: p.item_name ?? '',
              modelName: entry.modelName || sellerSku,
              shopeeStock: entry.stock,
              shopeePrice: entry.price,
              syncedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            };
            E.shopeeSkuMaps.push(map);
            createdMaps++;
          } else {
            map.productName = p.item_name ?? '';
            map.modelName = entry.modelName || sellerSku;
            map.shopeeStock = entry.stock;
            map.shopeePrice = entry.price;
            map.syncedAt = new Date().toISOString();
            updatedMaps++;
          }
          if (applyStock && entry.stock != null && entry.stock >= 0) {
            const found = findInternalVariant(state, sk, variant.sku);
            if (found && found.variant.stock !== entry.stock) {
              found.variant.stock = entry.stock;
              stockUpdated++;
            }
          }
        }
      }
    }
    if (items.length < 100) break;
  }
  cfg.lastSyncAt = new Date().toISOString();
  return ok({
    shopKey: sk,
    fetchedProducts: fetched,
    matched,
    createdMaps,
    updatedMaps,
    stockUpdated,
    unmatched: unmatched.slice(0, 20),
    unmatchedCount: unmatched.length,
    errors: errors.slice(0, 5),
    lastSyncAt: cfg.lastSyncAt,
  });
}

function hMapShopeeSku(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const internalSku = String(args.internalSku ?? '').trim();
  const itemId = String(args.itemId ?? '').trim();
  const modelId = String(args.modelId ?? '').trim();
  if (!internalSku || !itemId) return fail('Thiếu internalSku / itemId để map SKU Shopee.');
  const found = findInternalVariant(state, sk, internalSku);
  if (!found) return fail(`Không tìm thấy biến thể ${internalSku} trong catalogue của shop.`);
  const E = extState(state);
  let map = E.shopeeSkuMaps.find((m) => m.shopKey === sk && m.internalSku === internalSku && m.itemId === itemId && m.modelId === modelId);
  if (!map) {
    map = {
      id: `sm-${sk}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      shopKey: sk,
      internalSku,
      itemId,
      modelId,
      productName: typeof args.productName === 'string' ? args.productName : '',
      modelName: typeof args.modelName === 'string' ? args.modelName : internalSku,
      syncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    E.shopeeSkuMaps.push(map);
  } else {
    if (typeof args.productName === 'string') map.productName = args.productName;
    if (typeof args.modelName === 'string') map.modelName = args.modelName;
    map.syncedAt = new Date().toISOString();
  }
  return ok({ shopKey: sk, map });
}

function hUnmapShopeeSku(state: State, ctx: ActionContext, args: Record<string, any>): ActionResult {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const E = extState(state);
  const before = E.shopeeSkuMaps.length;
  const id = typeof args.id === 'string' ? args.id : '';
  if (id) {
    E.shopeeSkuMaps = E.shopeeSkuMaps.filter((m) => !(m.shopKey === sk && m.id === id));
  } else {
    const internalSku = String(args.internalSku ?? '').trim();
    const itemId = String(args.itemId ?? '').trim();
    const modelId = String(args.modelId ?? '').trim();
    if (!internalSku && !itemId) return fail('Thiếu id hoặc internalSku/itemId để gỡ map.');
    E.shopeeSkuMaps = E.shopeeSkuMaps.filter((m) => !(m.shopKey === sk && (!internalSku || m.internalSku === internalSku) && (!itemId || m.itemId === itemId) && (!modelId || m.modelId === modelId)));
  }
  return ok({ shopKey: sk, removed: before - E.shopeeSkuMaps.length });
}

async function hPushShopeeStock(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const E = extState(state);
  let targets = E.shopeeSkuMaps.filter((m) => m.shopKey === sk);
  if (typeof args.internalSku === 'string' && args.internalSku) targets = targets.filter((m) => m.internalSku === String(args.internalSku));
  if (typeof args.itemId === 'string' && args.itemId) targets = targets.filter((m) => m.itemId === String(args.itemId));
  if (typeof args.modelId === 'string' && args.modelId) targets = targets.filter((m) => m.modelId === String(args.modelId));
  if (targets.length === 0) return fail('Chưa có SKU nào được map Shopee (mở Kênh bán hàng → Shopee → Map SKU).');
  const mode = typeof args.mode === 'string' ? args.mode : 'both'; // 'stock' | 'price' | 'both'
  const byItem = new Map<string, ShopeeSkuMap[]>();
  for (const m of targets) {
    const list = byItem.get(m.itemId) ?? [];
    list.push(m);
    byItem.set(m.itemId, list);
  }
  const results: Array<{ itemId: string; internalSku: string; modelId: string; kind: string; ok: boolean; error?: string }> = [];
  for (const [itemId, list] of byItem) {
    const itemIdNum = Number(itemId);
    if (!Number.isFinite(itemIdNum)) {
      for (const m of list) results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'both', ok: false, error: 'item_id Shopee không hợp lệ.' });
      continue;
    }
    // Giá: 1 call / item (giá lấy theo sản phẩm nội bộ — Variant không có giá riêng).
    if (mode === 'price' || mode === 'both') {
      const priceList: Array<{ model_id: number; original_price: number }> = [];
      for (const m of list) {
        const found = findInternalVariant(state, sk, m.internalSku);
        if (!found) { results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'price', ok: false, error: 'Không tìm thấy biến thể nội bộ.' }); continue; }
        const modelIdNum = Number(m.modelId);
        if (!m.modelId || !Number.isFinite(modelIdNum)) { results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'price', ok: false, error: 'Item không có model_id — Shopee chỉ đổi giá theo model, xem lại trong Seller Center.' }); continue; }
        priceList.push({ model_id: modelIdNum, original_price: Math.max(0, Math.round(found.product.price)) });
      }
      if (priceList.length > 0) {
        const r = await updateShopeePrice(call, itemIdNum, priceList);
        for (const pl of priceList) {
          const m = list.find((x) => x.modelId === String(pl.model_id))!;
          if (r.ok) { m.shopeePrice = pl.original_price; m.syncedAt = new Date().toISOString(); }
          results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'price', ok: r.ok, error: r.ok ? undefined : r.error });
        }
      }
    }
    // Tồn kho: 1 call / item (mỗi model 1 dòng stock).
    if (mode === 'stock' || mode === 'both') {
      const stockList: Array<{ model_id: number; normal_stock: number }> = [];
      for (const m of list) {
        const found = findInternalVariant(state, sk, m.internalSku);
        if (!found) { results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'stock', ok: false, error: 'Không tìm thấy biến thể nội bộ.' }); continue; }
        if (found.variant.stock < 0) { results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'stock', ok: false, error: 'Biến thể không quản lý tồn kho (stock = -1).' }); continue; }
        const modelIdNum = Number(m.modelId);
        if (!m.modelId || !Number.isFinite(modelIdNum)) { results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'stock', ok: false, error: 'Item không có model_id — Shopee chỉ đổi tồn theo model, xem lại trong Seller Center.' }); continue; }
        stockList.push({ model_id: modelIdNum, normal_stock: Math.max(0, found.variant.stock) });
      }
      if (stockList.length > 0) {
        const r = await updateShopeeStock(call, itemIdNum, stockList);
        for (const sl of stockList) {
          const m = list.find((x) => x.modelId === String(sl.model_id))!;
          if (r.ok) { m.shopeeStock = sl.normal_stock; m.syncedAt = new Date().toISOString(); }
          results.push({ itemId, internalSku: m.internalSku, modelId: m.modelId, kind: 'stock', ok: r.ok, error: r.ok ? undefined : r.error });
        }
      }
    }
  }
  return ok({ shopKey: sk, pushed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
}

async function hSyncShopeeOrders(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const E = extState(state);
  const skuMaps = E.shopeeSkuMaps.filter((m) => m.shopKey === sk);
  const variants = internalVariantsForShop(state, sk);
  const daysBack = Number(args.daysBack ?? 7) || 7;
  const maxOrders = Math.min(200, Math.max(1, Number(args.maxOrders ?? 50) || 50));
  const now = Math.floor(Date.now() / 1000);
  const lastSync = cfg.lastSyncAt ? Math.floor(new Date(cfg.lastSyncAt).getTime() / 1000) : 0;
  const from = lastSync > 0 ? Math.max(lastSync - 3600, now - daysBack * 86400) : now - daysBack * 86400;
  const orderStatus = typeof args.orderStatus === 'string' && args.orderStatus ? args.orderStatus : undefined;
  let fetched = 0;
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const seen = new Set<string>();
  // Shopee get_order_list tối đa 15 ngày/lần → cắt thành từng cửa sổ 15 ngày.
  for (let wEnd = now; wEnd > from && fetched < maxOrders; wEnd = Math.max(from, wEnd - 15 * 86400)) {
    const wStart = Math.max(from, wEnd - 15 * 86400);
    let cursor: string | undefined;
    while (fetched < maxOrders) {
      const res = await getShopeeOrderList(call, {
        timeRangeField: 'update_time',
        timeFrom: wStart,
        timeTo: wEnd,
        pageSize: Math.min(100, maxOrders - fetched),
        cursor,
        orderStatus,
      });
      if (!res.ok) { errors.push(res.error); break; }
      const list = res.data.order_list ?? [];
      if (list.length === 0) break;
      // get_order_detail tối đa 50 mã/lần.
      for (let i = 0; i < list.length && fetched < maxOrders; i += 50) {
        const batch = list.slice(i, i + 50).map((o) => o.order_sn).filter((sn) => !seen.has(sn));
        for (const sn of batch) seen.add(sn);
        if (batch.length === 0) continue;
        const d = await getShopeeOrderDetail(call, batch);
        if (!d.ok) { errors.push(`Chi tiết đơn ${batch[0]}: ${d.error}`); continue; }
        for (const detail of d.data.order_list ?? []) {
          if (fetched >= maxOrders) break;
          fetched++;
          try {
            const up = upsertShopeeOrder(state, detail, sk, skuMaps, variants);
            const ext = up.order as OrderExt;
            ext.shopeeStatus = detail.order_status;
            ext.shopeeCurrency = 'VND';
            ext.shopeeMasked = shopeeIsMasked(detail.recipient_address?.name) || shopeeIsMasked(detail.recipient_address?.phone);
            ext.shopeeShopId = cfg.shopId ?? '';
            if (up.action === 'created') created++; else updated++;
          } catch (e) {
            errors.push(`Đơn ${detail.order_sn}: ${String((e as Error)?.message ?? e)}`);
          }
        }
      }
      cursor = res.data.next_cursor;
      if (!res.data.more || !cursor) break;
    }
  }
  cfg.lastSyncAt = new Date().toISOString();
  if (errors.length > 0) cfg.lastSyncError = errors[0];
  return ok({ shopKey: sk, fetched, created, updated, errors, lastSyncAt: cfg.lastSyncAt });
}

async function hSyncShopeeReturns(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const E = extState(state);
  const daysBack = Number(args.daysBack ?? 30) || 30;
  const now = Math.floor(Date.now() / 1000);
  const from = now - daysBack * 86400;
  const res = await getShopeeReturnList(call, { pageNo: 1, pageSize: 50, createTimeFrom: from, createTimeTo: now });
  if (!res.ok) return fail(`Lấy danh sách hoàn/trả Shopee thất bại: ${res.error}`);
  const items = (res.data.return ?? []) as Array<Record<string, unknown>>;
  let created = 0;
  let updated = 0;
  let slips = 0;
  for (const raw of items) {
    const platformReturnId = String(raw.return_sn ?? raw.return_id ?? '');
    const orderSn = String(raw.order_sn ?? '');
    if (!platformReturnId || !orderSn) continue;
    const order = state.orders.find((o) => o.shopKey === sk && (o as OrderExt).shopeeOrderSn === orderSn);
    const refund = shopeeMoneyToVnd(raw.refund_amount);
    const rec: ShopeeReturnRecord = {
      id: `sr-${sk}-${platformReturnId}`,
      shopKey: sk,
      platformReturnId,
      orderCode: order?.code ?? undefined,
      kind: 'return',
      status: String(raw.return_status ?? raw.status ?? ''),
      refundAmount: refund || undefined,
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      createdAt: typeof raw.create_time === 'number' ? new Date(raw.create_time * 1000).toISOString() : new Date().toISOString(),
      raw,
    };
    const existing = E.shopeeReturns.find((r) => r.shopKey === sk && r.platformReturnId === platformReturnId);
    if (existing) {
      Object.assign(existing, rec, { id: existing.id });
      updated++;
    } else {
      E.shopeeReturns.push(rec);
      created++;
    }
    if (order) {
      let slip = E.returnSlips.find((s) => s.shopKey === sk && s.shopeeReturnId === platformReturnId);
      if (!slip) {
        slip = {
          id: uid('ret'),
          shopKey: sk,
          orderId: (order as OrderExt).id,
          orderCode: order.code,
          reason: `Hoàn/trả Shopee: ${rec.reason ?? ''}`.slice(0, 200),
          items: order.items,
          status: mapShopeeReturnStatus(rec.status),
          at: nowIso(),
          by: ctxAccountId(ctx),
          shopeeReturnId: platformReturnId,
        };
        E.returnSlips.push(slip);
        slips++;
      }
      // Hoàn xong → đánh dấu đơn là hoàn hàng (không đụng đơn đã hủy).
      const done = /COMPLETE|SUCCESS|REFUND/i.test(rec.status);
      if (done && order.orderStatus !== 'hoan_hang' && order.orderStatus !== 'da_huy') {
        order.orderStatus = 'hoan_hang';
        const ext = order as unknown as Record<string, unknown>;
        const hist = (ext.history as Array<Record<string, unknown>> | undefined) ?? [];
        hist.push({ time: nowIso(), action: 'changeStatus', note: `Hoàn/trả Shopee ${platformReturnId} đã xử lý (${rec.status}).`, by: 'shopee-sync' });
        ext.history = hist;
      }
    }
  }
  return ok({ shopKey: sk, returns: items.length, created, updated, slips });
}

async function hSyncShopeeFinance(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const E = extState(state);
  const daysBack = Number(args.daysBack ?? 30) || 30;
  const nowMs = Date.now();
  const fromMs = nowMs - daysBack * 86400000;
  // Đối soát escrow theo từng đơn Shopee đã sync trong cửa sổ (tối đa 50 đơn/lần).
  const orders = state.orders
    .filter((o) => o.shopKey === sk && (o as OrderExt).source === 'shopee')
    .filter((o) => Date.parse(o.updatedAt ?? o.createdAt) >= fromMs)
    .slice(0, 50);
  let escrows = 0;
  let matchedOrders = 0;
  const errors: string[] = [];
  for (const order of orders) {
    const sn = (order as OrderExt).shopeeOrderSn;
    if (!sn) continue;
    const r = await getShopeeEscrowDetail(call, sn);
    if (!r.ok) { errors.push(`Escrow ${sn}: ${r.error}`); continue; }
    const income = r.data.order_income ?? {};
    const amount = shopeeMoneyToVnd(income.escrow_amount ?? 0);
    const rec: ShopeeFinanceRecord = {
      id: `sf-${sk}-${sn}`,
      shopKey: sk,
      kind: 'escrow',
      platformId: sn,
      orderCode: order.code,
      amount,
      currency: 'VND',
      detail: JSON.stringify({
        buyer_total: income.buyer_total_amount,
        commission_fee: income.commission_fee,
        service_fee: income.service_fee,
        seller_transaction_fee: income.seller_transaction_fee,
        shopee_discount: income.shopee_discount,
        seller_discount: income.seller_discount,
        buyer_paid_shipping_fee: income.buyer_paid_shipping_fee,
        actual_shipping_fee: income.actual_shipping_fee,
      }),
      createdAt: new Date().toISOString(),
      raw: r.data,
    };
    const existing = E.shopeeFinance.find((x) => x.shopKey === sk && x.kind === 'escrow' && x.platformId === sn);
    if (existing) Object.assign(existing, rec, { id: existing.id });
    else E.shopeeFinance.push(rec);
    escrows++;
    if (order.totalAmount > 0 && Math.abs(amount - order.totalAmount) < 5000) matchedOrders++;
  }
  // Sao kê rút tiền (payout) trong cửa sổ.
  const payoutRes = await getShopeePayoutDetail(call, {
    payoutTimeFrom: Math.floor(fromMs / 1000),
    payoutTimeTo: Math.floor(nowMs / 1000),
    pageNo: 1,
    pageSize: 50,
  });
  let payouts = 0;
  if (payoutRes.ok) {
    for (const p of payoutRes.data.payout_list ?? []) {
      const pid = String((p as Record<string, unknown>).payout_id ?? (p as Record<string, unknown>).id ?? '');
      if (!pid) continue;
      const amount = shopeeMoneyToVnd((p as Record<string, unknown>).payout_amount ?? (p as Record<string, unknown>).amount);
      const rec: ShopeeFinanceRecord = {
        id: `sfp-${sk}-${pid}`,
        shopKey: sk,
        kind: 'payout',
        platformId: pid,
        amount,
        currency: 'VND',
        createdAt: new Date().toISOString(),
        raw: p,
      };
      const existing = E.shopeeFinance.find((x) => x.shopKey === sk && x.kind === 'payout' && x.platformId === pid);
      if (existing) Object.assign(existing, rec, { id: existing.id });
      else E.shopeeFinance.push(rec);
      payouts++;
    }
  } else {
    errors.push(`Payout: ${payoutRes.error}`);
  }
  return ok({ shopKey: sk, escrows, payouts, matchedOrders, errors: errors.slice(0, 5) });
}

/** Lấy mã vận đơn + lịch sử giao hàng Shopee của 1 đơn (theo order_sn). */
async function hGetShopeeTracking(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const orderSn = typeof args.orderSn === 'string' ? args.orderSn.trim() : '';
  if (!orderSn) return fail('Thiếu orderSn Shopee.');
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const pkg = typeof args.packageNumber === 'string' ? args.packageNumber : undefined;
  const num = await getShopeeTrackingNumber(call, orderSn, pkg);
  const info = await getShopeeTrackingInfo(call, orderSn, pkg);
  if (!num.ok && !info.ok) return fail(`Lấy vận đơn Shopee thất bại: ${num.error ?? info.error}`);
  return ok({
    shopKey: sk,
    orderSn,
    trackingNumber: num.ok ? (num.data.tracking_number ?? null) : null,
    trackingInfo: info.ok ? (info.data.tracking_info ?? []) : [],
    errors: [num.ok ? null : num.error, info.ok ? null : info.error].filter(Boolean),
  });
}

async function hShopeePoll(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const orders = await hSyncShopeeOrders(state, ctx, { ...args, daysBack: 1, maxOrders: 50 });
  const returns = await hSyncShopeeReturns(state, ctx, { ...args, daysBack: 1 });
  let finance: ActionResult | null = null;
  if (args.finance === true || args.finance === 'true') {
    finance = await hSyncShopeeFinance(state, ctx, { ...args, daysBack: 1 });
  }
  return ok({ shopKey: sk, orders, returns, finance, polledAt: new Date().toISOString() });
}

/** Khôi phục push Shopee bị mất (get_lost_push_message + confirm). */
async function hGetShopeeLostPush(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const sk = requireShop(ctx, args);
  if (typeof sk !== 'string') return sk;
  const platformOrFail = requireShopeePlatform(state);
  if ('ok' in platformOrFail) return platformOrFail;
  const platform = platformOrFail;
  const token = await ensureShopeeAccessToken(state, sk);
  if (typeof token !== 'string') return token;
  const cfg = shopeeCfgOf(state, sk)!;
  const call = shopeeBaseCall(platform, cfg, token);
  const res = await getShopeeLostPushMessage(call);
  if (!res.ok) return fail(`Lấy push Shopee bị mất thất bại: ${res.error}`);
  const list = (res.data.message_list ?? []) as Array<Record<string, unknown>>;
  let confirmed = 0;
  if ((args.confirm === true || args.confirm === 'true') && list.length > 0) {
    const ids = list.map((m) => String(m.message_id ?? '')).filter(Boolean);
    if (ids.length > 0) {
      const c = await confirmShopeeLostPushMessage(call, ids);
      if (c.ok) confirmed = ids.length;
    }
  }
  return ok({ shopKey: sk, lost: list.length, confirmed, messages: list.slice(0, 20) });
}

// ---------------------------------------------------------------------------
// Webhook Shopee (push) — verify + lưu + xử lý
// ---------------------------------------------------------------------------

export interface ShopeePushOpts {
  rawBody: string;
  /** URL đầy đủ Shopee gọi (để verify chữ ký: callbackUrl + "|" + body). */
  callbackUrl?: string;
  authorization?: string | null;
  xShopeeSignature?: string | null;
  shopKey?: string;
}

/**
 * Nhận push Shopee: verify chữ ký bằng partner_key của app CHUNG, dedupe
 * theo SHA-256 của raw body, LƯU event rồi trả về — xử lý chạy riêng
 * (processStoredShopeePushEvent) để ack nhanh.
 * Push Shopee: {code, shop_id, data, timestamp}. Code: 1 shop authorized,
 * 2 shop deauthorized, 3 order status update, 4 tracking number update,
 * 10 buyer message, 12 authorization expiry (7 ngày trước).
 */
export async function handleShopeePush(state: State, opts: ShopeePushOpts): Promise<ActionResult> {
  const raw = opts.rawBody ?? '';
  if (!raw) return fail('Thiếu rawBody webhook Shopee.');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail('Webhook Shopee không phải JSON hợp lệ.');
  }
  const shopId = body.shop_id != null ? String(body.shop_id) : '';
  let shop = shopId ? state.shops.find((s) => (s as ShopExt).shopee?.shopId === shopId) : undefined;
  if (!shop && opts.shopKey) shop = state.shops.find((s) => s.key === opts.shopKey);
  if (!shop) return fail(shopId ? `Không tìm thấy shop Shopee cho shop_id ${shopId} (shop chưa kết nối Shopee?).` : 'Webhook Shopee thiếu shop_id.');
  // Chữ ký webhook verify bằng partner_key của app CHUNG (mọi shop dùng chung 1 app).
  const platform = shopeePlatformOf(state);
  if (!shopeePlatformConfigured(platform)) return fail('App Shopee chung chưa được cấu hình — không verify được chữ ký webhook.');
  // Thử cả URL request thực tế lẫn URL đã đăng ký trong console (sau proxy
  // protocol/host có thể khác URL Shopee đã ký).
  const urlCandidates = [opts.callbackUrl, platform.webhookUrl].filter((u): u is string => Boolean(u && u.trim()));
  const sigOk = urlCandidates.some((url) => verifyShopeePushSignature(platform.partnerKey, url, raw, opts.authorization ?? null, opts.xShopeeSignature ?? null));
  if (!sigOk) return fail('Chữ ký webhook Shopee không hợp lệ (sai partner_key của app chung hoặc body bị sửa).');
  const E = extState(state);
  const key = shopeeWebhookDedupeKey(raw);
  if (E.shopeeWebhookEvents.some((e) => (e as unknown as Record<string, unknown>).dedupeKey === key)) return ok({ duplicate: true, note: 'Event đã nhận trước đó.' });
  const code = typeof body.code === 'number' ? body.code : Number(body.code ?? 0);
  const data = (body.data ?? {}) as Record<string, unknown>;
  const event: ShopeeWebhookEvent & { dedupeKey?: string } = {
    id: `sw-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    shopKey: shop.key,
    dedupeKey: key,
    eventType: `push_${code}`,
    code,
    status: 'received',
    receivedAt: new Date().toISOString(),
    note: typeof data.order_sn === 'string' ? `order_sn ${data.order_sn}` : undefined,
    raw: body,
  };
  E.shopeeWebhookEvents.push(event as ShopeeWebhookEvent);
  return ok({ eventId: event.id, eventType: event.eventType, shopKey: shop.key, duplicate: false });
}

/** Xử lý 1 event webhook Shopee đã lưu (gọi API lấy chi tiết đơn khi cần). */
export async function processStoredShopeePushEvent(state: State, eventId: string): Promise<{ processed: boolean; note: string; orderCode?: string }> {
  const E = extState(state);
  const event = E.shopeeWebhookEvents.find((e) => e.id === eventId) as (ShopeeWebhookEvent & { dedupeKey?: string }) | undefined;
  if (!event) return { processed: false, note: 'Không tìm thấy event webhook.' };
  const sk = event.shopKey;
  const cfg = shopeeCfgOf(state, sk);
  if (!cfg) { event.status = 'failed'; event.note = 'Shop không còn cấu hình Shopee.'; return { processed: false, note: event.note }; }
  const code = event.code ?? 0;
  const data = (event.raw as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined ?? {};
  try {
    if (code === 2) {
      // Shop hủy ủy quyền trên Shopee → xóa token, cần kết nối lại.
      cfg.accessToken = ''; cfg.refreshToken = ''; cfg.shopId = ''; cfg.shopName = ''; cfg.status = 'revoked';
      event.status = 'processed'; event.note = 'Shop đã hủy ủy quyền Shopee — token đã xóa, cần kết nối lại.';
      return { processed: true, note: event.note };
    }
    if (code === 12) {
      // Ủy quyền sắp hết (7 ngày trước) → cảnh báo để shop ủy quyền lại.
      cfg.authExpiryWarning = true;
      event.status = 'processed'; event.note = 'Ủy quyền Shopee sắp hết hạn (Shopee báo trước 7 ngày) — bấm "Kết nối Shopee" để ủy quyền lại trước khi hết hạn.';
      return { processed: true, note: event.note };
    }
    if (code === 1) {
      event.status = 'processed'; event.note = 'Shop đã ủy quyền Shopee (push code 1).';
      return { processed: true, note: event.note };
    }
    if (code === 10) {
      // Tin nhắn khách — Chat API đã đóng với app mới nên KHÔNG gửi qua app.
      event.status = 'processed'; event.note = 'Khách nhắn tin trên Shopee — trả lời tay trong Seller Center (Chat API đã đóng với app bên thứ 3 mới từ 18/11/2024).';
      return { processed: true, note: event.note };
    }
    if (code === 3 || code === 4) {
      const orderSn = typeof data.order_sn === 'string' ? data.order_sn : '';
      if (!orderSn) { event.status = 'failed'; event.note = 'Event thiếu order_sn.'; return { processed: false, note: event.note }; }
      const token = await ensureShopeeAccessToken(state, sk);
      if (typeof token !== 'string') { const errMsg = token.error ?? 'Lỗi token Shopee.'; event.status = 'failed'; event.note = errMsg; return { processed: false, note: errMsg }; }
      const call = shopeeBaseCall(shopeePlatformOf(state), cfg, token);
      const d = await getShopeeOrderDetail(call, [orderSn]);
      if (!d.ok) { event.status = 'failed'; event.note = `Lấy chi tiết đơn ${orderSn} thất bại: ${d.error}`; return { processed: false, note: event.note }; }
      const detail = (d.data.order_list ?? [])[0];
      if (!detail) { event.status = 'failed'; event.note = `Shopee không trả chi tiết đơn ${orderSn}.`; return { processed: false, note: event.note }; }
      const skuMaps = E.shopeeSkuMaps.filter((m) => m.shopKey === sk);
      const variants = internalVariantsForShop(state, sk);
      const up = upsertShopeeOrder(state, detail, sk, skuMaps, variants);
      const ext = up.order as OrderExt;
      ext.shopeeStatus = detail.order_status;
      ext.shopeeCurrency = 'VND';
      ext.shopeeMasked = shopeeIsMasked(detail.recipient_address?.name) || shopeeIsMasked(detail.recipient_address?.phone);
      ext.shopeeShopId = cfg.shopId ?? '';
      event.status = 'processed';
      event.note = `Đơn ${up.order.code} (${up.action === 'created' ? 'mới' : 'cập nhật'}) — trạng thái Shopee ${detail.order_status}.`;
      return { processed: true, note: event.note, orderCode: up.order.code };
    }
    event.status = 'failed'; event.note = `Push code Shopee chưa hỗ trợ (${code}) — đã lưu event để xem lại.`;
    return { processed: false, note: event.note };
  } catch (e) {
    event.status = 'failed'; event.note = String((e as Error)?.message ?? e);
    return { processed: false, note: event.note };
  }
}

async function hShopeeWebhookReceive(state: State, ctx: ActionContext, args: Record<string, any>): Promise<ActionResult> {
  const rawBody = typeof args.rawBody === 'string' ? args.rawBody : '';
  if (!rawBody) return fail('Thiếu rawBody webhook Shopee.');
  const handled = await handleShopeePush(state, {
    rawBody,
    callbackUrl: typeof args.callbackUrl === 'string' ? args.callbackUrl : undefined,
    authorization: typeof args.authorization === 'string' ? args.authorization : null,
    xShopeeSignature: typeof args.xShopeeSignature === 'string' ? args.xShopeeSignature : null,
    shopKey: typeof args.shopKey === 'string' ? args.shopKey : undefined,
  });
  if (!handled.ok) return handled;
  if (handled.duplicate) return ok({ duplicate: true, note: 'Event đã nhận trước đó.' });
  const eventId = String(handled.eventId ?? '');
  const processed = await processStoredShopeePushEvent(state, eventId);
  return ok({ eventId, eventType: handled.eventType, shopKey: handled.shopKey, ...processed });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Điểm vào duy nhất cho mọi action. ctx = server.ts { account, shopKey, hostShopKey, version }
 * hoặc dạng brief { role, shopKey, accountId, isSuperAdmin }.
 * Action không có trong ACTION_NAMES -> lỗi 'Action không tồn tại'.
 * Action có tên nhưng chưa triển khai đầy đủ -> lỗi 'Chưa triển khai trong bản standalone'.
 */
export async function handleAction(
  state: State,
  actionName: string,
  args: Record<string, any>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const a: Record<string, any> = args ?? {};
  try {
    switch (actionName) {
      case 'addinternalnote': return hAddInternalNote(state, ctx, a);
      case 'addlivecomment': return hAddLiveComment(state, ctx, a);
      case 'adjustcostprice': return hAdjustCostPrice(state, ctx, a);
      case 'adjustloyaltypoints': return hAdjustLoyaltyPoints(state, ctx, a);
      case 'advancereturnslip': return hAdvanceReturnSlip(state, ctx, a);
      case 'aianalyzereview': return hAiAnalyzeReview(state, ctx, a);
      case 'aichat': return hAiChat(state, ctx, a);
      case 'aiextractorder': return hAiExtractOrder(state, ctx, a);
      case 'aigeneratecontent': return hAiGenerateContent(state, ctx, a);
      case 'aiproposerule': return hAiProposeRule(state, ctx, a);
      case 'aisuggestnote': return hAiSuggestNote(state, ctx, a);
      case 'appendlocalmessage': return hAppendLocalMessage(state, ctx, a);
      case 'applypershopdataisolation': return hApplyPerShopDataIsolation(state, ctx, a);
      case 'applypickuppointconfig': return hApplyPickupPointConfig(state, ctx, a);
      case 'applyproductshipfeerules': return hApplyProductShipFeeRules(state, ctx, a);
      case 'applystockaudit': return hApplyStockAudit(state, ctx, a);
      case 'applystockbatch': return hApplyStockBatch(state, ctx, a);
      case 'applystockin': return hApplyStockIn(state, ctx, a);
      case 'applystocktransfer': return hApplyStockTransfer(state, ctx, a);
      case 'applyxinhorderprice': return hApplyXinhOrderPrice(state, ctx, a);
      case 'approveaidraft': return hApproveAiDraft(state, ctx, a);
      case 'approvetiktokreturn': return hApproveTikTokReturn(state, ctx, a);
      case 'assignconversation': return hAssignConversation(state, ctx, a);
      case 'assistantchat': return hAssistantChat(state, ctx, a);
      case 'attachwaybilltoorder': return hAttachWaybillToOrder(state, ctx, a);
      case 'bestwebhookreceive': return hReceiveWebhookEvent(state, ctx, { ...a, provider: 'best' });
      case 'bulkorderaction': return hBulkOrderAction(state, ctx, a);
      case 'calculatetiktokrefund': return hCalculateTikTokRefund(state, ctx, a);
      case 'cancelwaybill': return hCancelWaybill(state, ctx, a);
      case 'changeorderstatus': return hChangeOrderStatus(state, ctx, a);
      case 'checkcontractfees': return hCheckContractFees(state, ctx, a);
      case 'checkshopaikey': return hCheckShopAiKey(state, ctx, a);
      case 'cleartrainchat': return hClearTrainChat(state, ctx, a);
      case 'confirmcarrierreturnreceived': return hConfirmCarrierReturnReceived(state, ctx, a);
      case 'confirmtrainrule': return hConfirmTrainRule(state, ctx, a);
      case 'connectfanpages': return hConnectFanpages(state, ctx, a);
      case 'connectpagewithtoken': return hConnectPageWithToken(state, ctx, a);
      case 'createcashentry': return hCreateCashEntry(state, ctx, a);
      case 'createorder': return hCreateOrder(state, ctx, a);
      case 'createreturnslip': return hCreateReturnSlip(state, ctx, a);
      case 'createshopaccount': return hCreateShopAccount(state, ctx, a);
      case 'deleteairule': return hDeleteAiRule(state, ctx, a);
      case 'deletechathashtag': return hDeleteChatHashtag(state, ctx, a);
      case 'deleteinternalnote': return hDeleteInternalNote(state, ctx, a);
      case 'deletelivecomment': return hDeleteLiveComment(state, ctx, a);
      case 'deletelivesession': return hDeleteLiveSession(state, ctx, a);
      case 'deleteorder': return hDeleteOrder(state, ctx, a);
      case 'deleteproduct': return hDeleteProduct(state, ctx, a);
      case 'deleterecordbykind': return hDeleteRecordByKind(state, ctx, a);
      case 'deleteshop': return hDeleteShop(state, ctx, a);
      case 'deleteshopaccount': return hDeleteShopAccount(state, ctx, a);
      case 'disconnectcarrier': return hDisconnectCarrier(state, ctx, a);
      case 'disconnectfanpage': return hDisconnectFanpage(state, ctx, a);
      case 'disconnectshopee': return hDisconnectShopee(state, ctx, a);
      case 'disconnectshopcapipixel': return hDisconnectShopCapiPixel(state, ctx, a);
      case 'disconnecttiktok': return hDisconnectTikTok(state, ctx, a);
      case 'endlivesession': return hEndLiveSession(state, ctx, a);
      case 'exchangeoauthcode': return hExchangeOAuthCode(state, ctx, a);
      case 'exchangeshopeecode': return hExchangeShopeeCode(state, ctx, a);
      case 'exchangetiktokcode': return hExchangeTikTokCode(state, ctx, a);
      case 'generateclaudeapikey': return hGenerateClaudeApiKey(state, ctx, a);
      case 'getbootstrap': return hGetBootstrap(state, ctx);
      case 'getcapiconfig': return hGetCapiConfig(state, ctx, a);
      case 'getcaresettings': return hGetCareSettings(state, ctx, a);
      case 'getclaudeconnection': return hGetClaudeConnection(state, ctx, a);
      case 'getinvitesettings': return hGetInviteSettings(state, ctx, a);
      case 'getoauthurl': return hGetOAuthUrl(state, ctx, a);
      case 'getorderhistory': return hGetOrderHistory(state, ctx, a);
      case 'getshopeechannels': return hGetShopeeChannels(state, ctx, a);
      case 'getshopeelostpush': return hGetShopeeLostPush(state, ctx, a);
      case 'getshopeeoauthurl': return hGetShopeeOAuthUrl(state, ctx, a);
      case 'getshopeeplatformconfig': return hGetShopeePlatformConfig(state, ctx, a);
      case 'getshopeeproducts': return hGetShopeeProducts(state, ctx, a);
      case 'getshopeetracking': return hGetShopeeTracking(state, ctx, a);
      case 'getshopquota': return hGetShopQuota(state, ctx, a);
      case 'gettrainchat': return hGetTrainChat(state, ctx, a);
      case 'gettiktokchannels': return hGetTikTokChannels(state, ctx, a);
      case 'gettiktokoauthurl': return hGetTikTokOAuthUrl(state, ctx, a);
      case 'gettiktokplatformconfig': return hGetTikTokPlatformConfig(state, ctx, a);
      case 'gettiktokproducts': return hGetTikTokProducts(state, ctx, a);
      case 'listshopmetapixels': return hListShopMetaPixels(state, ctx, a);
      case 'loginaccount': return hLoginAccount(state, a);
      case 'mapshopeesku': return hMapShopeeSku(state, ctx, a);
      case 'maptiktoksku': return hMapTikTokSku(state, ctx, a);
      case 'markcommentsread': return hMarkCommentsRead(state, ctx, a);
      case 'marklivecommentordered': return hMarkLiveCommentOrdered(state, ctx, a);
      case 'migratemetaconnections': return hMigrateMetaConnections(state, ctx, a);
      case 'paysupplierdebt': return hPaySupplierDebt(state, ctx, a);
      case 'precheckbulkship': return hPrecheckBulkShip(state, ctx, a);
      case 'printcarrierwaybill': return hPrintCarrierWaybill(state, ctx, a);
      case 'processaiqueue': return hProcessAiQueue(state, ctx, a);
      case 'processcommentqueue': return hProcessCommentQueue(state, ctx, a);
      case 'pushcommenttoinbox': return hPushCommentToInbox(state, ctx, a);
      case 'pushorderstocarrier': return hPushOrdersToCarrier(state, ctx, a);
      case 'pushshopeestock': return hPushShopeeStock(state, ctx, a);
      case 'pushtiktokstock': return hPushTikTokStock(state, ctx, a);
      case 'quotecarrierfee': return hQuoteCarrierFee(state, ctx, a);
      case 'receivewebhookevent': return hReceiveWebhookEvent(state, ctx, a);
      case 'recordorderprint': return hRecordOrderPrint(state, ctx, a);
      case 'redeempointsforcoupon': return hRedeemPointsForCoupon(state, ctx, a);
      case 'refreshcampaignstats': return hRefreshCampaignStats(state, ctx, a);
      case 'refreshshopeetoken': return hRefreshShopeeToken(state, ctx, a);
      case 'refreshtiktoktoken': return hRefreshTikTokToken(state, ctx, a);
      case 'refreshwaybillstatus': return hRefreshWaybillStatus(state, ctx, a);
      case 'registertiktokwebhook': return hRegisterTikTokWebhook(state, ctx, a);
      case 'rejectaidraft': return hRejectAiDraft(state, ctx, a);
      case 'rejecttiktokreturn': return hRejectTikTokReturn(state, ctx, a);
      case 'replycommentpublic': return hReplyCommentPublic(state, ctx, a);
      case 'resendcapipurchase': return hResendCapiPurchase(state, ctx, a);
      case 'revealclaudeapikey': return hRevealClaudeApiKey(state, ctx, a);
      case 'runcarenudges': return hRunCareNudges(state, ctx, a);
      case 'saveairule': return hSaveAiRule(state, ctx, a);
      case 'savecapiconfig': return hSaveCapiConfig(state, ctx, a);
      case 'savecaresettings': return hSaveCareSettings(state, ctx, a);
      case 'savecarrierconfig': return hSaveCarrierConfig(state, ctx, a);
      case 'savecommentscript': return hSaveCommentScript(state, ctx, a);
      case 'saveconversationnote': return hSaveConversationNote(state, ctx, a);
      case 'saveinvitesettings': return hSaveInviteSettings(state, ctx, a);
      case 'savelivesession': return hSaveLiveSession(state, ctx, a);
      case 'saveloyaltyconfig': return hSaveLoyaltyConfig(state, ctx, a);
      case 'savemetaconfig': return hSaveMetaConfig(state, ctx, a);
      case 'saveproduct': return hSaveProduct(state, ctx, a);
      case 'saverecord': return hSaveRecord(state, ctx, a);
      case 'savesaasconfig': return hSaveSaasConfig(state, ctx, a);
      case 'saveshipfeerules': return hSaveShipFeeRules(state, ctx, a);
      case 'saveshopeeplatformconfig': return hSaveShopeePlatformConfig(state, ctx, a);
      case 'saveshop': return hSaveShop(state, ctx, a);
      case 'saveshopcapipixel': return hSaveShopCapiPixel(state, ctx, a);
      case 'saveshopshipfeerules': return hSaveShipFeeRules(state, ctx, a);
      case 'savesingleton': return hSaveSingleton(state, ctx, a);
      case 'savetiktokplatformconfig': return hSaveTikTokPlatformConfig(state, ctx, a);
      case 'scancodreconciliation': return hScanCodReconciliation(state, ctx, a);
      case 'seedinitialdata': return hSeedInitialData(state, ctx, a);
      case 'seedquickreplytemplates': return hSeedQuickReplyTemplates(state, ctx, a);
      case 'seedsampleorders': return hSeedSampleOrders(state, ctx, a);
      case 'sendcampaign': return hSendCampaign(state, ctx, a);
      case 'sendcapitestevent': return hSendCapiTestEvent(state, ctx, a);
      case 'sendchatimage': return hSendChatImage(state, ctx, a);
      case 'sendchatmessage': return hSendChatMessage(state, ctx, a);
      case 'sendtiktokmessage': return hSendTikTokMessage(state, ctx, a);
      case 'setconversationhashtags': return hSetConversationHashtags(state, ctx, a);
      case 'setshopaikey': return hSetShopAiKey(state, ctx, a);
      case 'setupsuperadmin': return hSetupSuperAdmin(state, ctx, a);
      case 'shopeepoll': return hShopeePoll(state, ctx, a);
      case 'shopeewebhookreceive': return hShopeeWebhookReceive(state, ctx, a);
      case 'startlivesession': return hStartLiveSession(state, ctx, a);
      case 'synccomments': return hSyncComments(state, ctx, a);
      case 'syncconversations': return hSyncConversations(state, ctx, a);
      case 'syncshopeefinance': return hSyncShopeeFinance(state, ctx, a);
      case 'syncshopeeorders': return hSyncShopeeOrders(state, ctx, a);
      case 'syncshopeeproducts': return hSyncShopeeProducts(state, ctx, a);
      case 'syncshopeereturns': return hSyncShopeeReturns(state, ctx, a);
      case 'synctiktokfinance': return hSyncTikTokFinance(state, ctx, a);
      case 'synctiktokorders': return hSyncTikTokOrders(state, ctx, a);
      case 'synctiktokproducts': return hSyncTikTokProducts(state, ctx, a);
      case 'synctiktokreturns': return hSyncTikTokReturns(state, ctx, a);
      case 'testcarrierconnection': return hTestCarrierConnection(state, ctx, a);
      case 'tiktokpoll': return hTikTokPoll(state, ctx, a);
      case 'tiktokwebhookreceive': return hTikTokWebhookReceive(state, ctx, a);
      case 'trackwaybill': return hTrackWaybill(state, ctx, a);
      case 'trainchat': return hTrainChat(state, ctx, a);
      case 'unmapshopeesku': return hUnmapShopeeSku(state, ctx, a);
      case 'unmaptiktoksku': return hUnmapTikTokSku(state, ctx, a);
      case 'updatechathashtag': return hUpdateChatHashtag(state, ctx, a);
      case 'updateorder': return hUpdateOrder(state, ctx, a);
      case 'updateshopaccount': return hUpdateShopAccount(state, ctx, a);
      case 'updatevariantstock': return hUpdateVariantStock(state, ctx, a);
      case 'verifyclaudeapikey': return hVerifyClaudeApiKey(state, ctx, a);
      case 'verifyfacebooktoken': return hVerifyFacebookToken(state, ctx, a);
      case 'verifywebhook': return hVerifyWebhook(state, ctx, a);
      default:
        if (ACTION_NAMES.includes(actionName)) {
          return fail(`Chưa triển khai trong bản standalone: ${actionName}`);
        }
        return fail(`Action không tồn tại: ${actionName}`);
    }
  } catch (err: any) {
    return fail(`Lỗi khi chạy action ${actionName}: ${err?.message ?? String(err)}`);
  }
}
