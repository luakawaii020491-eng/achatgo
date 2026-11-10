// store.ts — Lưu state vào Postgres (khi có DATABASE_URL) hoặc file JSON.
// Mô hình v37: tài khoản shop chỉ thấy dữ liệu của đúng shop mình; shop mới
// bắt đầu TRỐNG HOÀN TOÀN; dữ liệu cũ chỉ Super Admin thấy (chế độ tất cả
// shop), KHÔNG xóa.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import type { Role, State } from './types.js';
import { tiktokPlatformPublic } from './tiktok.js';
import { shopeePlatformPublic } from './shopee.js';

/** Đường dẫn file dữ liệu: env DATA_FILE, mặc định ./data/achatgo.json. */
export function dataFilePath(): string {
  return process.env.DATA_FILE ?? path.join(process.cwd(), 'data', 'achatgo.json');
}

/** State trống — KHÔNG seed dữ liệu khách thật (xem seed.ts). */
export function createEmptyState(): State {
  return {
    shops: [],
    accounts: [],
    products: [],
    orders: [],
    customers: [],
    conversations: [],
    fanpages: [],
    shipFeeRulesByShop: {},
    shipFeeRules: [],
    aiRules: [],
    carriers: [],
    coupons: [],
    campaigns: [],
    cashEntries: [],
    loyaltyConfig: {
      vndPerPoint: 10000,
      pointValueVnd: 500,
      tiers: [
        { name: 'Bạc', minSpent: 1000000, discountPercent: 2 },
        { name: 'Vàng', minSpent: 5000000, discountPercent: 5 },
      ],
    },
    saasConfig: {
      plans: [
        { key: 'dung-thu', name: 'Dùng thử', pageLimit: 1, staffLimit: 1, price: 0 },
        { key: 'co-ban', name: 'Cơ bản', pageLimit: 5, staffLimit: 5, price: 0 },
        { key: 'nang-cao', name: 'Nâng cao', pageLimit: 10, staffLimit: 10, price: 0 },
      ],
      extraPagePrice: 20000,
      extraStaffPrice: 20000,
      hotline: '0916636785',
      mainDomain: 'achat.vn',
      trialDaysOptions: [1, 7],
    },
    shippingConfig: {
      pickupPoint: { name: '', phone: '', address: '' },
      defaultFee: 30000,
    },
    metaConfig: { appId: '', redirectUri: '' },
    /** App TikTok Shop chung (mô hình Achat — 1 app cho cả nền tảng, Super Admin nhập 1 lần). */
    tiktokPlatform: { appKey: '', appSecret: '', serviceId: '', redirectUri: '', webhookUrl: '', authorizeHost: '', apiVersion: '202309' },
    shopeePlatform: { partnerId: '', partnerKey: '', redirectUri: '', webhookUrl: '', apiHost: '', sandbox: false },
    capiConfigByShop: {},
    hashtags: [],
    quickReplies: [],
  };
}

/**
 * Hậu trường lưu trữ — Postgres khi có DATABASE_URL (Render), file JSON khi
 * không có. Một dòng JSONB duy nhất trong bảng app_state (id = 1) giữ toàn
 * bộ state; load = SELECT, save = INSERT ... ON CONFLICT DO UPDATE.
 * Render Postgres bắt buộc SSL (rejectUnauthorized: false vì dùng cert
 * tự ký của Render). Save được nối đuôi (promise chain) để 2 lần ghi
 * đồng thời không đè mất dữ liệu của nhau (bản file đồng bộ trước đây
 * vốn không có race này).
 */
const PG_TABLE = 'app_state';
const PG_ROW_ID = 1;

let pool: Pool | null = null;
/** Seam cho test: chèn Pool giả (vd pg-mem). Production không dùng. */
let poolOverride: unknown = null;
export function __setPoolForTest(p: unknown): void {
  poolOverride = p;
}

/** true khi app chạy ở chế độ Postgres (có DATABASE_URL). */
export function isPostgresMode(): boolean {
  return !!process.env.DATABASE_URL;
}

function getPool(): Pool | null {
  if (poolOverride) return poolOverride as Pool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
    pool.on('error', (err) => console.error('[achatgo] lỗi pool Postgres:', err));
  }
  return pool;
}

async function ensureTable(p: Pool): Promise<void> {
  await p.query(
    `CREATE TABLE IF NOT EXISTS ${PG_TABLE} (id integer PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL)`,
  );
}

/** Đọc state (async). Chưa có dòng nào / file chưa có / hỏng -> state trống. */
export async function loadState(filePath: string = dataFilePath()): Promise<State> {
  const p = getPool();
  if (!p) {
    // Fallback file JSON (đồng bộ như trước đây).
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<State>;
      // Gộp với state trống để file cũ thiếu trường vẫn đủ collection.
      return { ...createEmptyState(), ...parsed };
    } catch {
      return createEmptyState();
    }
  }
  // Chế độ Postgres: lỗi kết nối PHẢI nổ ra (fail-closed) thay vì lặng lẽ
  // dùng file rồi seed đè mất dữ liệu thật — Render sẽ restart service.
  await ensureTable(p);
  const r = await p.query(`SELECT data FROM ${PG_TABLE} WHERE id = $1`, [PG_ROW_ID]);
  if (r.rows.length === 0) return createEmptyState();
  const parsed = r.rows[0].data as Partial<State>;
  return { ...createEmptyState(), ...parsed };
}

let saveChain: Promise<void> = Promise.resolve();

/** Ghi state (async, nối đuôi để không race khi 2 request ghi cùng lúc). */
export function saveState(state: State, filePath: string = dataFilePath()): Promise<void> {
  const run = async (): Promise<void> => {
    const p = getPool();
    if (!p) {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
      return;
    }
    await ensureTable(p);
    await p.query(
      `INSERT INTO ${PG_TABLE} (id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [PG_ROW_ID, JSON.stringify(state)],
    );
  };
  const next = saveChain.then(run, run);
  saveChain = next.catch(() => {});
  return next;
}

/**
 * Lọc state theo quyền xem của người gọi. Trả về BẢN SAO (không sửa state gốc).
 * - super_admin: thấy tất cả (kể cả sản phẩm 'shared' và dữ liệu shop cũ).
 * - shop_owner / staff: chỉ thấy đúng shop mình (shopKey).
 * - Sản phẩm shopKey 'shared' CHỈ Super Admin thấy; shop thường không thấy
 *   trừ khi chính shop đó tạo (lúc đó shopKey là key của shop, không phải
 *   'shared').
 * - loyaltyConfig / saasConfig / shippingConfig / metaConfig / carriers /
 *   hashtags là cấu hình dùng chung nên mọi role đều thấy.
 */
export function scopeState(state: State, role: Role, shopKey: string | null): State {
  if (role === 'super_admin') {
    // Deep copy để bên gọi không vô tình sửa state gốc.
    return JSON.parse(JSON.stringify(state)) as State;
  }
  if (!shopKey) {
    // Tài khoản shop mà không có shopKey thì không thấy dữ liệu shop nào.
    const empty = createEmptyState();
    empty.loyaltyConfig = state.loyaltyConfig;
    empty.saasConfig = state.saasConfig;
    empty.shippingConfig = state.shippingConfig;
    empty.metaConfig = state.metaConfig;
    empty.carriers = state.carriers;
    empty.hashtags = state.hashtags;
    return empty;
  }
  const scoped = createEmptyState();
  scoped.shops = state.shops.filter((s) => s.key === shopKey);
  scoped.accounts = state.accounts.filter((a) => a.shopKey === shopKey);
  // Shop thường không thấy sản phẩm 'shared' của Super Admin.
  scoped.products = state.products.filter((p) => p.shopKey === shopKey);
  scoped.orders = state.orders.filter((o) => o.shopKey === shopKey);
  scoped.customers = state.customers.filter((c) => c.shopKey === shopKey);
  scoped.conversations = state.conversations.filter((c) => c.shopKey === shopKey);
  scoped.fanpages = state.fanpages.filter((f) => f.shopKey === shopKey);
  scoped.shipFeeRulesByShop = state.shipFeeRulesByShop[shopKey]
    ? { [shopKey]: state.shipFeeRulesByShop[shopKey] }
    : {};
  // Fallback toàn cục vẫn áp cho shop (để tính phí khi shop chưa có rule).
  scoped.shipFeeRules = state.shipFeeRules;
  scoped.aiRules = state.aiRules.filter((r) => r.shopKey === shopKey);
  scoped.coupons = state.coupons.filter((c) => c.shopKey === shopKey);
  scoped.campaigns = state.campaigns.filter((c) => c.shopKey === shopKey);
  scoped.cashEntries = state.cashEntries.filter((e) => e.shopKey === shopKey);
  scoped.loyaltyConfig = state.loyaltyConfig;
  scoped.saasConfig = state.saasConfig;
  scoped.shippingConfig = state.shippingConfig;
  scoped.metaConfig = state.metaConfig;
  scoped.capiConfigByShop = state.capiConfigByShop[shopKey]
    ? { [shopKey]: state.capiConfigByShop[shopKey] }
    : {};
  scoped.hashtags = state.hashtags;
  scoped.quickReplies = state.quickReplies.filter((q) => q.shopKey === shopKey);
  return scoped;
}

/**
 * Khởi tạo dữ liệu trống cho một shop mới (quy tắc 2026-11-09: shop mới
 * bắt đầu 0 sản phẩm / 0 đơn / 0 khách / 0 quy tắc ship...). Trả về một
 * State chỉ chứa các collection trống của shop đó — bên gọi gộp vào state
 * chung (thêm shop vào state.shops, thêm entry rỗng vào shipFeeRulesByShop
 * và capiConfigByShop) rồi saveState.
 */
export function newShopState(shopKey: string): State {
  const empty = createEmptyState();
  empty.shipFeeRulesByShop = { [shopKey]: [] };
  empty.capiConfigByShop = {
    [shopKey]: { shopKey, pixelId: '', connected: false },
  };
  return empty;
}
