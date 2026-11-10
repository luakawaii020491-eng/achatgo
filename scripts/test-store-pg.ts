// test-store-pg.ts — Kiểm tra đường Postgres của src/store.ts bằng Pool giả
// trong bộ nhớ (pg-mem không parse được PRIMARY KEY/NOT NULL trong
// CREATE TABLE nên không dùng được ở đây; SQL production vẫn là Postgres
// chuẩn và sẽ được kiểm chứng bằng bài test persistence trên Render).
// Chạy: npx tsx scripts/test-store-pg.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

const store = await import('../src/store.js');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ok — ${msg}`);
}

/** Pool giả: chỉ hiểu đúng 3 câu SQL mà store.ts phát ra. */
class FakePool {
  rows = new Map<number, unknown>();
  seen: string[] = [];
  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.seen.push(sql.replace(/\s+/g, ' ').trim());
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('CREATE TABLE')) return { rows: [] };
    if (s.startsWith('SELECT data FROM')) {
      const id = params[0] as number;
      // Deep-clone như Postgres thật (mỗi SELECT parse JSONB mới).
      return { rows: this.rows.has(id) ? [{ data: JSON.parse(JSON.stringify(this.rows.get(id))) }] : [] };
    }
    if (s.startsWith('INSERT INTO')) {
      assert(s.includes('ON CONFLICT'), 'INSERT dùng ON CONFLICT (upsert)');
      const id = params[0] as number;
      this.rows.set(id, JSON.parse(String(params[1])));
      return { rows: [] };
    }
    throw new Error(`FakePool: câu SQL lạ: ${s}`);
  }
}

console.log('[test] Postgres mode:', store.isPostgresMode());
assert(store.isPostgresMode(), 'DATABASE_URL bật chế độ Postgres');

// --- Đường Postgres qua FakePool ---
const fake = new FakePool();
store.__setPoolForTest(fake);

console.log('[test] 1. loadState trên DB trống -> state trống');
let s = await store.loadState();
assert(Array.isArray(s.accounts) && s.accounts.length === 0, 'state trống, 0 tài khoản');
assert(Array.isArray(s.shops) && s.shops.length === 0, 'state trống, 0 shop');
assert(fake.seen.some((q) => q.includes('CREATE TABLE')), 'đã chạy CREATE TABLE IF NOT EXISTS');

console.log('[test] 2. save -> load giữ nguyên dữ liệu');
s.shops.push({
  key: 'shopeetest', name: 'Shopee Test', domain: 'shopeetest.achat.vn',
  plan: 'dung-thu', pageLimit: 1, staffLimit: 1, trialEndsAt: null,
  status: 'trial', createdAt: '2026-11-10T00:00:00+07:00',
} as never);
s.accounts.push({
  id: 'acc-test', email: 'shopee-test@achat.vn', username: 'shopeetest',
  passwordHash: 'hash', role: 'shop_owner', shopKey: 'shopeetest',
  displayName: 'Shopee Test', createdAt: '2026-11-10T00:00:00+07:00',
} as never);
await store.saveState(s);
const s2 = await store.loadState();
assert(s2.shops.length === 1 && s2.shops[0].key === 'shopeetest', 'shop shopeetest còn sau save/load');
assert(s2.accounts.length === 1 && s2.accounts[0].username === 'shopeetest', 'tài khoản shopeetest còn sau save/load');

console.log('[test] 3. save lần 2 (upsert) cập nhật, không nhân dòng');
s2.products.push({
  id: 'prd-1', shopKey: 'shopeetest', name: 'Dép test', sku: 'TEST-01',
  price: 50000, variants: [],
} as never);
await store.saveState(s2);
const s3 = await store.loadState();
assert(s3.products.length === 1 && s3.products[0].sku === 'TEST-01', 'sản phẩm thêm ở lần save 2 còn nguyên');
assert(s3.shops.length === 1 && s3.accounts.length === 1, 'không nhân dòng shop/account sau upsert');
assert(fake.rows.size === 1, 'chỉ 1 dòng app_state trong DB (upsert đúng)');

console.log('[test] 4. 2 lần save đồng thời không crash, state nhất quán');
const a = await store.loadState();
const b = await store.loadState();
a.orders.push({ id: 'ord-a', shopKey: 'shopeetest' } as never);
b.orders.push({ id: 'ord-b', shopKey: 'shopeetest' } as never);
await Promise.all([store.saveState(a), store.saveState(b)]);
const s4 = await store.loadState();
// a và b là 2 bản sao khác nhau của cùng state gốc — lần save sau ghi đè
// lần trước (đúng ngữ nghĩa "ghi toàn bộ state"); cả 2 đều phải hoàn tất
// không lỗi, và lần save sau thắng.
assert(s4.orders.length === 1, 'save đồng thời không crash, state nhất quán (last-writer-wins)');
assert(s4.shops.length === 1 && s4.accounts.length === 1, 'shop/account vẫn nguyên sau save đồng thời');

console.log('[test] 5. scopeState vẫn cách ly theo shop (không đổi)');
const scoped = store.scopeState(s4, 'shop_owner', 'shopeetest');
assert(scoped.shops.length === 1 && scoped.shops[0].key === 'shopeetest', 'shop_owner chỉ thấy shop mình');
const scopedOther = store.scopeState(s4, 'shop_owner', 'xinh');
assert(scopedOther.shops.length === 0, 'shop khác không thấy shop shopeetest');

// --- Đường file JSON khi không có DATABASE_URL ---
console.log('[test] 6. không có DATABASE_URL -> fallback file JSON');
store.__setPoolForTest(null);
delete process.env.DATABASE_URL;
assert(!store.isPostgresMode(), 'tắt DATABASE_URL -> chế độ file');
const tmpFile = path.join(os.tmpdir(), `achatgo-test-${Date.now()}.json`);
const f = store.createEmptyState();
f.shops.push({ key: 'filetest', name: 'File Test' } as never);
await store.saveState(f, tmpFile);
const f2 = await store.loadState(tmpFile);
assert(f2.shops.length === 1 && f2.shops[0].key === 'filetest', 'file fallback ghi/đọc đúng');
fs.unlinkSync(tmpFile);

console.log('\nALL STORE TESTS PASSED');
