// scripts/test-tiktok.ts — kiểm thử TikTok Shop bằng mock (KHÔNG gọi API thật).
// Chạy: npx tsx scripts/test-tiktok.ts
// Mock globalThis.fetch để giả lập TikTok Shop Open API 202309.
import * as crypto from 'node:crypto';
import {
  TIKTOK_SCOPES,
  buildTikTokAuthorizeUrl,
  exchangeAuthCode,
  findOrderByTikTokId,
  getAuthorizedShops,
  getOrderDetail,
  groupTikTokLineItems,
  mapTikTokOrderStatus,
  mapTikTokOrderToOrderInput,
  refreshAccessToken,
  searchOrders,
  signTikTokRequest,
  tiktokIsMasked,
  tiktokMoneyToVnd,
  tiktokWebhookDedupeKey,
  upsertTikTokOrder,
  verifyTikTokWebhookSignature,
} from '../src/tiktok.js';
import type { TikTokOrder } from '../src/tiktok.js';
import { handleAction, handleTikTokWebhook } from '../src/actions.js';

// ---------------------------------------------------------------------------
// Khung test tối giản
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed++; failures.push(name); console.log(`  ✗ ${name}: ${(e as Error).message}`); });
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`${msg} (nhận ${JSON.stringify(a)}, muốn ${JSON.stringify(b)})`);
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------
type MockBody = { code: number; message: string; request_id: string; data: any };
let mockHandler: ((url: string, init: any) => MockBody) | null = null;
globalThis.fetch = (async (url: any, _init: any) => {
  if (!mockHandler) throw new Error(`fetch gọi mà chưa mock: ${String(url)}`);
  const body = mockHandler(String(url), _init);
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}) as any;

function okBody(data: any): MockBody {
  return { code: 0, message: 'success', request_id: 'req-test-1', data };
}

// ---------------------------------------------------------------------------
// Dữ liệu mock
// ---------------------------------------------------------------------------
const MOCK_VN_ORDER: TikTokOrder = {
  id: '578123456789012345',
  status: 'AWAITING_SHIPMENT',
  create_time: 1762752000,
  update_time: 1762755600,
  is_cod: true,
  payment_method_name: 'COD',
  payment: {
    currency: 'VND',
    sub_total: '150000.00',
    shipping_fee: '0.00',
    seller_discount: '0.00',
    platform_discount: '0.00',
    total_amount: '150000.00',
  },
  recipient_address: {
    name: 'Nguyễn Thị A',
    phone_number: '0912345678',
    full_address: 'Số 1 Đường ABC, Quận 1, TP Hồ Chí Minh',
  },
  line_items: [
    { id: 'li1', product_id: '1720001', sku_id: '1720001001', seller_sku: 'DQN-DEN-36', sku_name: 'Đen 36', sale_price: '50000.00' },
    { id: 'li2', product_id: '1720001', sku_id: '1720001001', seller_sku: 'DQN-DEN-36', sku_name: 'Đen 36', sale_price: '50000.00' },
    { id: 'li3', product_id: '1720001', sku_id: '1720001001', seller_sku: 'DQN-DEN-36', sku_name: 'Đen 36', sale_price: '50000.00' },
  ],
};

function fakeState(): any {
  return {
    shops: [{ key: 'xinh', name: 'DÉP XINH', tiktok: undefined }],
    // App TikTok CHUNG (mô hình Achat) — 1 app cho cả nền tảng, Super Admin nhập 1 lần.
    tiktokPlatform: undefined,
    orders: [],
    products: [
      {
        id: 'p-dqn', shopKey: 'xinh', name: 'DÉP QUAI NGANG', groupName: 'Quai ngang',
        price: 50000, image: '', createdAt: '2026-11-10T00:00:00.000Z',
        variants: [{ sku: 'DQN-DEN-36', color: 'Đen', size: '36', stock: 10, costPrice: 0 }],
      },
    ],
    customers: [],
    accounts: [{ id: 'acc1', role: 'shop_owner', shopKey: 'xinh', name: 'Chủ shop Xinh' }],
  };
}
const ctx = { account: { role: 'shop_owner', shopKey: 'xinh', id: 'acc1' }, shopKey: 'xinh', hostShopKey: null, version: 'test' };
const superCtx = { account: { role: 'super_admin', shopKey: null, id: 'admin1' }, shopKey: null, hostShopKey: null, version: 'test' };

/** App TikTok chung đã cấu hình (Super Admin nhập 1 lần). */
function platformApp(): any {
  return {
    appKey: APP_KEY, appSecret: APP_SECRET, serviceId: '123456',
    redirectUri: 'https://achat.vn/auth/tiktok/callback',
    webhookUrl: 'https://achat.vn/webhook/tiktok',
    authorizeHost: '', apiVersion: '202309',
  };
}
/** Shop đã kết nối dưới app chung (chỉ token + cipher, KHÔNG còn appKey/appSecret riêng). */
function connectedShopTikTok(): any {
  return {
    status: 'connected', shopId: '749123456789', shopName: 'DÉP XINH', shopCipher: 'CIPHER-ABC',
    accessToken: 'AT-1', refreshToken: 'RT-1',
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
    grantedScopes: ['seller.order.info'],
  };
}

// ---------------------------------------------------------------------------
// 1. Ký request (worked example đã kiểm chứng)
// ---------------------------------------------------------------------------
await test('ký request: worked example e59af819cc → b596b73e…', () => {
  const { sign, timestamp } = signTikTokRequest('e59af819cc', '/authorization/202309/shops', { app_key: '29a39d' }, undefined, 1623812664);
  eq(sign, 'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8', 'chữ ký sai');
  eq(timestamp, '1623812664', 'timestamp sai');
});
await test('ký request: loại sign/access_token khỏi chuỗi ký, timestamp khác → ký khác', () => {
  const a = signTikTokRequest('secret', '/order/202309/orders/search', { app_key: 'k', sign: 'cu', access_token: 'tok' }, '{"a":1}', 1000);
  const b = signTikTokRequest('secret', '/order/202309/orders/search', { app_key: 'k' }, '{"a":1}', 1000);
  eq(a.sign, b.sign, 'sign/access_token phải bị loại khỏi chuỗi ký');
  const c = signTikTokRequest('secret', '/order/202309/orders/search', { app_key: 'k' }, '{"a":1}', 1001);
  assert(a.sign !== c.sign, 'timestamp khác phải cho chữ ký khác');
});

// ---------------------------------------------------------------------------
// 2. Authorize URL + scope
// ---------------------------------------------------------------------------
await test('authorize URL: đúng host Global + service_id + state', () => {
  const url = buildTikTokAuthorizeUrl({ serviceId: '123456', state: 'xinh:abc123' });
  assert(url.startsWith('https://services.tiktokshop.com/open/authorize?'), `host sai: ${url}`);
  assert(url.includes('service_id=123456'), 'thiếu service_id');
  assert(url.includes('state=xinh%3Aabc123') || url.includes('state=xinh:abc123'), 'thiếu state');
});
await test('scope: đủ 10 scope bắt buộc (bật trước khi ủy quyền)', () => {
  const keys = TIKTOK_SCOPES.map((s) => s.key);
  const required = [
    'seller.authorization.info', 'seller.shop.info', 'seller.order.info',
    'seller.product.basic', 'seller.product.write', 'seller.fulfillment.basic',
    'seller.logistics.basic', 'seller.return_refund.basic', 'seller.finance.info',
    'seller.promotion.info',
  ];
  for (const r of required) assert(keys.includes(r), `thiếu scope ${r}`);
});

// ---------------------------------------------------------------------------
// 3. Verify chữ ký webhook
// ---------------------------------------------------------------------------
const APP_KEY = '29a39d';
const APP_SECRET = 'e59af819cc';
const RAW_BODY = JSON.stringify({ type: 'ORDER_STATUS_CHANGE', shop_id: '749123456789', timestamp: 1762755600, data: { order_id: '578123456789012345' } });
const GOOD_SIG = crypto.createHmac('sha256', APP_SECRET).update(Buffer.concat([Buffer.from(APP_KEY, 'utf8'), Buffer.from(RAW_BODY, 'utf8')])).digest('hex');
await test('verify webhook: chữ ký đúng → true', () => {
  assert(verifyTikTokWebhookSignature(APP_KEY, APP_SECRET, RAW_BODY, GOOD_SIG) === true, 'phải verify được');
});
await test('verify webhook: sai secret / body bị sửa / thiếu header → false', () => {
  assert(verifyTikTokWebhookSignature(APP_KEY, 'sai-secret', RAW_BODY, GOOD_SIG) === false, 'sai secret phải fail');
  assert(verifyTikTokWebhookSignature(APP_KEY, APP_SECRET, RAW_BODY + 'x', GOOD_SIG) === false, 'body bị sửa phải fail');
  assert(verifyTikTokWebhookSignature(APP_KEY, APP_SECRET, RAW_BODY, null) === false, 'thiếu header phải fail');
  assert(verifyTikTokWebhookSignature(APP_KEY, APP_SECRET, RAW_BODY, 'deadbeef') === false, 'chữ ký lạ phải fail');
});

// ---------------------------------------------------------------------------
// 4. Đổi code / refresh token (expiry là timestamp TUYỆT ĐỐI, không phải số giây)
// ---------------------------------------------------------------------------
await test('exchangeAuthCode: parse token + expiry tuyệt đối', async () => {
  mockHandler = (url) => {
    assert(url.startsWith('https://auth.tiktok-shops.com/api/v2/token/get'), `host sai: ${url}`);
    assert(url.includes('grant_type=authorized_code'), 'thiếu grant_type');
    return okBody({
      access_token: 'AT-1', refresh_token: 'RT-1',
      access_token_expire_in: 1763352000, refresh_token_expire_in: 1765944000,
      granted_scopes: ['seller.order.info', 'seller.product.basic'],
      seller_name: 'DÉP XINH',
    });
  };
  const r = await exchangeAuthCode({ appKey: APP_KEY, appSecret: APP_SECRET, authCode: 'CODE-1' });
  assert(r.ok, `đổi code phải ok: ${r.ok ? '' : (r as any).error}`);
  if (r.ok) {
    eq(r.data.access_token, 'AT-1', 'access token sai');
    eq(r.data.access_token_expire_in, 1763352000, 'expiry phải là timestamp tuyệt đối');
    eq(r.data.granted_scopes?.length, 2, 'scope sai');
  }
});
await test('refreshAccessToken: trả cả refresh token mới', async () => {
  mockHandler = (url) => {
    assert(url.includes('grant_type=refresh_token'), 'thiếu grant_type refresh');
    return okBody({ access_token: 'AT-2', refresh_token: 'RT-2', access_token_expire_in: 1763438400, refresh_token_expire_in: 1766030400, granted_scopes: ['seller.order.info'] });
  };
  const r = await refreshAccessToken({ appKey: APP_KEY, appSecret: APP_SECRET, refreshToken: 'RT-1' });
  assert(r.ok, 'refresh phải ok');
  if (r.ok) { eq(r.data.access_token, 'AT-2', 'access token mới sai'); eq(r.data.refresh_token, 'RT-2', 'refresh token mới phải được lưu lại'); }
});
await test('getAuthorizedShops: phân giải cipher + shop id', async () => {
  mockHandler = (url) => {
    assert(url.includes('/authorization/202309/shops'), `path sai: ${url}`);
    return okBody({ shops: [{ id: '749123456789', name: 'DÉP XINH', cipher: 'CIPHER-ABC', code: 'VN', region: 'VN' }] });
  };
  const r = await getAuthorizedShops({ appKey: APP_KEY, appSecret: APP_SECRET, accessToken: 'AT-1', apiVersion: '202309' });
  assert(r.ok, 'lấy shop phải ok');
  if (r.ok) { eq(r.data.shops[0].cipher, 'CIPHER-ABC', 'cipher sai'); eq(r.data.shops[0].id, '749123456789', 'shop id sai'); }
});

// ---------------------------------------------------------------------------
// 5. Map trạng thái + gom line item + map đơn
// ---------------------------------------------------------------------------
await test('map trạng thái: đủ 9 trạng thái TikTok', () => {
  const cases: Array<[string, string]> = [
    ['UNPAID', 'cho_duyet'], ['ON_HOLD', 'cho_duyet'], ['AWAITING_SHIPMENT', 'cho_dong_goi'],
    ['AWAITING_COLLECTION', 'cho_lay_hang'], ['PARTIALLY_SHIPPING', 'dang_giao_hang'],
    ['IN_TRANSIT', 'dang_giao_hang'], ['DELIVERED', 'da_giao_hang'],
    ['COMPLETED', 'da_giao_hang'], ['CANCELLED', 'da_huy'],
  ];
  for (const [input, want] of cases) eq(mapTikTokOrderStatus(input), want, `map ${input}`);
});
await test('gom line item: 3 entry cùng sku → 1 dòng qty 3', () => {
  const grouped = groupTikTokLineItems(MOCK_VN_ORDER.line_items);
  eq(grouped.length, 1, 'phải gom thành 1 dòng');
  eq(grouped[0].quantity, 3, 'qty phải là 3');
  eq(grouped[0].sellerSku, 'DQN-DEN-36', 'seller_sku sai');
});
await test('map đơn VN: tiền VND, COD, seller_sku khớp catalogue', () => {
  const input = mapTikTokOrderToOrderInput(MOCK_VN_ORDER, [], [{ sku: 'DQN-DEN-36', color: 'Đen', size: '36', productId: 'p-dqn' }]);
  eq(input.items.length, 1, 'phải có 1 dòng hàng');
  eq(input.items[0].quantity, 3, 'qty 3');
  eq(input.items[0].sku, 'DQN-DEN-36', 'sku sai');
  eq(input.goodsTotal, 150000, 'tiền hàng sai');
  eq(input.totalAmount, 150000, 'tổng sai');
  eq(input.remainingCod, 150000, 'COD phải = tổng khi is_cod');
  eq(input.masked, false, 'SĐT thật thì masked phải false');
  eq(input.customerPhone, '0912345678', 'SĐT sai');
  assert(input.sourceNote.includes('578123456789012345'), 'ghi chú phải có mã đơn sàn');
});
await test('map đơn: SĐT bị che → masked true, không upsert khách', () => {
  const maskedOrder: TikTokOrder = {
    ...MOCK_VN_ORDER,
    recipient_address: { ...MOCK_VN_ORDER.recipient_address, name: 'N*** A', phone_number: '091***5678' },
  };
  assert(tiktokIsMasked('091***5678') === true, 'SĐT che phải nhận ra');
  const input = mapTikTokOrderToOrderInput(maskedOrder, [], []);
  eq(input.masked, true, 'masked phải true');
  eq(tiktokMoneyToVnd('149000.00'), 149000, 'tiền chuỗi thập phân sai');
});

// ---------------------------------------------------------------------------
// 6. upsert đơn: tạo rồi cập nhật, không trùng
// ---------------------------------------------------------------------------
await test('upsertTikTokOrder: tạo mới rồi cập nhật trạng thái, không trùng đơn', () => {
  const state = fakeState();
  const skuMaps: any[] = [];
  const variants = [{ sku: 'DQN-DEN-36', color: 'Đen', size: '36', productId: 'p-dqn' }];
  const first = upsertTikTokOrder(state, 'xinh', MOCK_VN_ORDER, skuMaps, variants, 'test');
  assert(first.created === true, 'lần đầu phải tạo mới');
  assert(first.order.code.startsWith('ACH77'), `mã đơn sai: ${first.order.code}`);
  eq((first.order as any).source, 'tiktok', 'source phải là tiktok');
  eq((first.order as any).capiStatus, 'chua_ket_noi', 'đơn TikTok không báo CAPI');
  eq((first.order as any).tiktokOrderId, '578123456789012345', 'thiếu mã đơn sàn');
  eq(state.orders.length, 1, 'phải có đúng 1 đơn');
  eq(state.customers.length, 1, 'SĐT thật phải upsert khách');
  const delivered = { ...MOCK_VN_ORDER, status: 'DELIVERED', update_time: 1762759200 };
  const second = upsertTikTokOrder(state, 'xinh', delivered, skuMaps, variants, 'test');
  assert(second.created === false, 'lần hai phải cập nhật');
  eq(second.order.code, first.order.code, 'mã đơn phải giữ nguyên');
  eq(state.orders.length, 1, 'không được tạo trùng đơn');
  eq(second.order.orderStatus, 'da_giao_hang', 'trạng thái phải đổi sang đã giao');
  assert(second.statusChanged === true, 'phải ghi nhận đổi trạng thái');
  const found = findOrderByTikTokId(state, 'xinh', '578123456789012345');
  assert(found?.code === first.order.code, 'findOrderByTikTokId phải tìm được đơn');
});

// ---------------------------------------------------------------------------
// 7. Lỗi rate limit (36009002)
// ---------------------------------------------------------------------------
await test('rate limit 36009002: map thành lỗi có mã, không crash', async () => {
  mockHandler = () => ({ code: 36009002, message: 'Too many requests', request_id: 'req-rl', data: null });
  const r = await searchOrders({ appKey: APP_KEY, appSecret: APP_SECRET, accessToken: 'AT-1', apiVersion: '202309' }, { update_time_ge: 1, update_time_lt: 2 }, 10);
  assert(r.ok === false, 'phải trả lỗi');
  if (!r.ok) {
    eq(r.code, 36009002, 'mã lỗi sai');
    assert(r.error.includes('36009002'), 'thông báo phải giữ mã lỗi');
  }
});

// ---------------------------------------------------------------------------
// 8. Webhook dedupe + action handlers với fake state
// ---------------------------------------------------------------------------
await test('webhook dedupe: cùng body → cùng key, khác body → khác key', () => {
  const k1 = tiktokWebhookDedupeKey(RAW_BODY);
  const k2 = tiktokWebhookDedupeKey(RAW_BODY);
  const k3 = tiktokWebhookDedupeKey(RAW_BODY + ' ');
  eq(k1, k2, 'cùng body phải cùng key');
  assert(k1 !== k3, 'khác body phải khác key');
  eq(k1.length, 64, 'key phải là SHA-256 hex (64 ký tự)');
});

await test('action savetiktokplatformconfig/gettiktokplatformconfig: chỉ Super Admin, secret không lộ', async () => {
  const state = fakeState();
  const saved = await handleAction(state, 'savetiktokplatformconfig', {
    config: {
      appKey: APP_KEY, appSecret: APP_SECRET, serviceId: '123456',
      redirectUri: 'https://achat.vn/auth/tiktok/callback',
      webhookUrl: 'https://achat.vn/webhook/tiktok',
    },
  }, superCtx);
  assert(saved.ok, `lưu app chung phải ok: ${saved.error ?? ''}`);
  eq((saved as any).platform.configured, true, 'đủ 3 giá trị thì configured phải true');
  const got = await handleAction(state, 'gettiktokplatformconfig', {}, superCtx);
  assert(got.ok, 'đọc app chung phải ok');
  const platform = (got as any).platform;
  assert(typeof platform.appKey === 'string' && platform.appKey.includes('*'), 'appKey trả về phải bị che');
  assert(!('appSecret' in platform) || !platform.appSecret, 'appSecret không được trả về');
  eq(platform.configured, true, 'configured phải true');
  // Shop thường gọi cũng bị chặn.
  const shopTry = await handleAction(state, 'gettiktokplatformconfig', {}, ctx);
  assert(shopTry.ok === false, 'shop thường không được đọc app chung');
  assert(String(shopTry.error).includes('Super Admin'), `phải báo chỉ Super Admin: ${shopTry.error}`);
  const shopSave = await handleAction(state, 'savetiktokplatformconfig', { config: { serviceId: 'x' } }, ctx);
  assert(shopSave.ok === false, 'shop thường không được lưu app chung');
});
await test('action savetiktokplatformconfig: URL sai → từ chối (http ngoài localhost, query, không phải URL)', async () => {
  const state = fakeState();
  const bad1 = await handleAction(state, 'savetiktokplatformconfig', { config: { redirectUri: 'http://example.com/cb' } }, superCtx);
  assert(bad1.ok === false, 'http ngoài localhost phải bị từ chối');
  const bad2 = await handleAction(state, 'savetiktokplatformconfig', { config: { webhookUrl: 'https://achat.vn/webhook/tiktok?x=1' } }, superCtx);
  assert(bad2.ok === false, 'URL có query phải bị từ chối');
  const bad3 = await handleAction(state, 'savetiktokplatformconfig', { config: { redirectUri: 'not-a-url' } }, superCtx);
  assert(bad3.ok === false, 'chuỗi không phải URL phải bị từ chối');
  const good = await handleAction(state, 'savetiktokplatformconfig', { config: { redirectUri: 'http://localhost:3000/auth/tiktok/callback' } }, superCtx);
  assert(good.ok === true, 'http://localhost được phép để test local');
});
await test('action gettiktokchannels: trả 2 kênh + platformConfigured theo app chung', async () => {
  const state = fakeState();
  const r0 = await handleAction(state, 'gettiktokchannels', {}, ctx);
  assert(r0.ok, 'gettiktokchannels phải ok');
  const ch0 = (r0 as any).channels;
  eq(ch0.length, 2, 'phải có 2 kênh');
  eq(ch0[0].id, 'tiktok', 'kênh đầu phải là tiktok');
  eq(ch0[0].status, 'disconnected', 'chưa kết nối thì disconnected');
  eq(ch0[0].platformConfigured, false, 'chưa có app chung thì platformConfigured false');
  eq(ch0[0].hasConfig, false, 'chưa có app chung thì hasConfig false');
  state.tiktokPlatform = platformApp();
  const r1 = await handleAction(state, 'gettiktokchannels', {}, ctx);
  eq((r1 as any).channels[0].platformConfigured, true, 'đã có app chung thì platformConfigured true');
  eq((r1 as any).channels[0].hasConfig, true, 'đã có app chung thì hasConfig true');
  eq((r1 as any).channels[0].webhookUrl, 'https://achat.vn/webhook/tiktok', 'webhook URL lấy từ app chung');
});
await test('action gettiktokoauthurl: chưa cấu hình app chung → lỗi rõ ràng; đã cấu hình → trả URL', async () => {
  const state = fakeState();
  const r = await handleAction(state, 'gettiktokoauthurl', {}, ctx);
  assert(r.ok === false, 'chưa cấu hình app chung phải lỗi');
  assert(String(r.error).includes('App TikTok chung'), `thông báo phải rõ ràng: ${r.error}`);
  state.tiktokPlatform = platformApp();
  const r2 = await handleAction(state, 'gettiktokoauthurl', {}, ctx);
  assert(r2.ok, `đã cấu hình app chung phải trả URL: ${r2.error ?? ''}`);
  assert(String((r2 as any).url).includes('service_id=123456'), 'URL phải có service_id của app chung');
  assert(String((r2 as any).url).startsWith('https://services.tiktokshop.com/open/authorize?'), 'host authorize sai');
});
await test('action disconnecttiktok: chỉ xóa token shop, app chung còn nguyên', async () => {
  const state = fakeState();
  state.tiktokPlatform = platformApp();
  (state.shops[0] as any).tiktok = connectedShopTikTok();
  const r = await handleAction(state, 'disconnecttiktok', {}, ctx);
  assert(r.ok, 'ngắt kết nối phải ok');
  const t = (state.shops[0] as any).tiktok;
  eq(t.status, 'disconnected', 'status shop phải disconnected');
  eq(t.accessToken, '', 'access token shop phải bị xóa');
  eq(t.refreshToken, '', 'refresh token shop phải bị xóa');
  eq(t.shopCipher, '', 'cipher shop phải bị xóa');
  eq(state.tiktokPlatform.appKey, APP_KEY, 'appKey app chung không được đụng tới');
  eq(state.tiktokPlatform.appSecret, APP_SECRET, 'appSecret app chung không được đụng tới');
  eq(state.tiktokPlatform.serviceId, '123456', 'serviceId app chung không được đụng tới');
});
await test('đổi app_key app chung → token các shop bị xóa (phải ủy quyền lại)', async () => {
  const state = fakeState();
  state.tiktokPlatform = platformApp();
  (state.shops[0] as any).tiktok = connectedShopTikTok();
  const r = await handleAction(state, 'savetiktokplatformconfig', { config: { appKey: 'NEW-APP-KEY', appSecret: APP_SECRET, serviceId: '123456' } }, superCtx);
  assert(r.ok, 'lưu app chung mới phải ok');
  assert((r as any).tokensCleared === true, 'đổi app_key phải báo tokensCleared');
  const t = (state.shops[0] as any).tiktok;
  eq(t.status, 'disconnected', 'token shop phải bị xóa khi đổi app chung');
  eq(t.accessToken, '', 'access token shop phải bị xóa');
  // Lưu lại cùng app_key thì KHÔNG xóa token.
  (state.shops[0] as any).tiktok = connectedShopTikTok();
  const r2 = await handleAction(state, 'savetiktokplatformconfig', { config: { redirectUri: 'https://achat.vn/auth/tiktok/callback' } }, superCtx);
  assert(r2.ok, 'lưu lại cùng app_key phải ok');
  assert((r2 as any).tokensCleared === false, 'không đổi app_key thì không xóa token');
  eq((state.shops[0] as any).tiktok.status, 'connected', 'token shop phải còn nguyên');
});
await test('action tiktokwebhookreceive: verify + lưu + xử lý đơn, lần 2 trùng → duplicate', async () => {
  const state = fakeState();
  // App chung đã cấu hình + shop đã kết nối dưới app chung (token còn hạn xa để không refresh).
  state.tiktokPlatform = platformApp();
  (state.shops[0] as any).tiktok = connectedShopTikTok();
  mockHandler = (url) => {
    assert(url.includes('/order/202309/orders/578123456789012345'), `phải gọi getOrderDetail: ${url}`);
    return okBody(MOCK_VN_ORDER);
  };
  const args = { rawBody: RAW_BODY, authorization: GOOD_SIG };
  const first = await handleAction(state, 'tiktokwebhookreceive', args, ctx);
  assert(first.ok, `webhook lần 1 phải ok: ${first.error ?? ''}`);
  assert((first as any).processed === true, 'phải xử lý được event');
  assert(typeof (first as any).orderCode === 'string' && (first as any).orderCode.startsWith('ACH77'), 'phải tạo đơn app');
  eq(state.orders.length, 1, 'phải có 1 đơn sau webhook');
  const second = await handleAction(state, 'tiktokwebhookreceive', args, ctx);
  assert(second.ok && (second as any).duplicate === true, 'lần 2 cùng body phải là duplicate');
  eq(state.orders.length, 1, 'duplicate không được tạo thêm đơn');
});
await test('handleTikTokWebhook trực tiếp: chữ ký sai → 401-style fail', async () => {
  const state = fakeState();
  state.tiktokPlatform = platformApp();
  (state.shops[0] as any).tiktok = { status: 'connected', shopId: '749123456789' };
  const r = await handleTikTokWebhook(state, { rawBody: RAW_BODY, authorization: 'deadbeef' });
  assert(r.ok === false, 'chữ ký sai phải fail');
});

// ---------------------------------------------------------------------------
// Tổng kết
// ---------------------------------------------------------------------------
console.log(`\nTikTok test: ${passed} passed, ${failed} failed${failures.length ? ` — lỗi: ${failures.join(', ')}` : ''}`);
if (failed > 0) process.exit(1);
