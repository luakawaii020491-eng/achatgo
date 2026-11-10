// scripts/test-shopee.ts — kiểm thử Shopee Open Platform API v2 bằng mock (KHÔNG gọi API thật).
// Chạy: npx tsx scripts/test-shopee.ts
// Mock globalThis.fetch để giả lập Shopee API v2 (envelope {error, message, response, request_id}).
import * as crypto from 'node:crypto';
import {
  SHOPEE_SANDBOX_HOST,
  buildShopeeAuthorizeUrl,
  consumeShopeeAuthState,
  createShopeeAuthState,
  exchangeShopeeAuthCode,
  findOrderByShopeeSn,
  getShopeeOrderDetail,
  getShopeeOrderList,
  groupShopeeLineItems,
  mapShopeeOrderStatus,
  mapShopeeOrderToOrderInput,
  parseShopeeSkuName,
  refreshShopeeAccessToken,
  shopeeIsMasked,
  shopeeMoneyToVnd,
  shopeePlatformPublic,
  shopeeWebhookDedupeKey,
  signShopeeRequest,
  upsertShopeeOrder,
  verifyShopeePushSignature,
} from '../src/shopee.js';
import type { ShopeeOrderDetail } from '../src/shopee.js';
import { handleAction, handleShopeePush } from '../src/actions.js';

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
// Mock fetch — envelope Shopee: {error, message, response, request_id}
// ---------------------------------------------------------------------------
type MockBody = { error: string; message: string; request_id: string; response: any };
let mockHandler: ((url: string, init: any) => MockBody) | null = null;
globalThis.fetch = (async (url: any, _init: any) => {
  if (!mockHandler) throw new Error(`fetch gọi mà chưa mock: ${String(url)}`);
  const body = mockHandler(String(url), _init);
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}) as any;

function okBody(response: any): MockBody {
  return { error: '', message: '', request_id: 'req-test-1', response };
}
function errBody(error: string, message = ''): MockBody {
  return { error, message, request_id: 'req-test-1', response: {} };
}

// ---------------------------------------------------------------------------
// Dữ liệu mock
// ---------------------------------------------------------------------------
const PARTNER_ID = '123456';
const PARTNER_KEY = 'testkey';
const MOCK_VN_ORDER: ShopeeOrderDetail = {
  order_sn: '240110ABC123',
  order_status: 'READY_TO_SHIP',
  create_time: 1762752000,
  update_time: 1762755600,
  pay_time: 1762753000,
  buyer_user_id: 123456789,
  buyer_username: 'nguyenthia',
  recipient_address: {
    name: 'Nguyễn Thị A',
    phone: '0912345678',
    full_address: 'Số 1 Đường ABC, Quận 1, TP Hồ Chí Minh',
    district: 'Quận 1',
    city: 'TP Hồ Chí Minh',
    state: 'TP Hồ Chí Minh',
  },
  item_list: [
    { item_id: 1001, item_name: 'Dép quai ngang', item_sku: 'DQN-DEN', model_id: 2001, model_name: 'Đen, 36', model_sku: 'DQN-DEN-36', model_quantity_purchased: 1, model_original_price: 50000, model_discounted_price: 50000 },
    { item_id: 1001, item_name: 'Dép quai ngang', item_sku: 'DQN-DEN', model_id: 2001, model_name: 'Đen, 36', model_sku: 'DQN-DEN-36', model_quantity_purchased: 1, model_original_price: 50000, model_discounted_price: 50000 },
    { item_id: 1001, item_name: 'Dép quai ngang', item_sku: 'DQN-DEN', model_id: 2001, model_name: 'Đen, 36', model_sku: 'DQN-DEN-36', model_quantity_purchased: 1, model_original_price: 50000, model_discounted_price: 50000 },
  ],
  package_list: [{ package_number: 'PKG-1', logistics_channel_id: 1, shipping_carrier: 'Shopee Express', tracking_number: 'SPXVN123456789' }],
  total_amount: 150000,
  actual_shipping_fee: 0,
  estimated_shipping_fee: 0,
  payment_method: 'Cash on Delivery',
};

function fakeState(): any {
  return {
    shops: [{ key: 'xinh', name: 'DÉP XINH', shopee: undefined }],
    // App Shopee CHUNG (mô hình Achat) — 1 app ISV cho cả nền tảng, Super Admin nhập 1 lần.
    shopeePlatform: undefined,
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

/** App Shopee chung đã cấu hình (Super Admin nhập 1 lần). */
function platformApp(): any {
  return {
    partnerId: PARTNER_ID, partnerKey: PARTNER_KEY,
    redirectUri: 'https://achat.vn/auth/shopee/callback',
    webhookUrl: 'https://achat.vn/webhook/shopee',
    apiHost: '', sandbox: false,
  };
}
/** Shop đã kết nối dưới app chung (chỉ token, KHÔNG còn partner key riêng). */
function connectedShopShopee(): any {
  return {
    status: 'connected', shopId: '789', shopName: 'DÉP XINH',
    accessToken: 'AT-1', refreshToken: 'RT-1',
    accessTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    connectedAt: new Date().toISOString(),
  };
}
function shopeeCall(): any {
  return { partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, accessToken: 'AT-1', shopId: '789' };
}

// ---------------------------------------------------------------------------
// 1. Ký request (worked example đã kiểm chứng bằng node crypto)
// ---------------------------------------------------------------------------
await test('ký request public: partner_id + path + timestamp', () => {
  const sign = signShopeeRequest('testkey', '123456', '/api/v2/shop/auth_partner', 1700000000);
  eq(sign, 'a43710904eedad61067635988cb8fc26cf4d6037b62869740cc78aaa3fb2a92e', 'chữ ký public sai');
});
await test('ký request shop-level: + access_token + shop_id, timestamp khác → ký khác', () => {
  const a = signShopeeRequest('testkey', '123456', '/api/v2/order/get_order_list', 1700000000, 'AT-1', '789');
  eq(a, '35a814a335ec50a47221ea43c8ae154ab3c23d1600f42a9303df6ea4ea5314ae', 'chữ ký shop-level sai');
  const b = signShopeeRequest('testkey', '123456', '/api/v2/order/get_order_list', 1700000001, 'AT-1', '789');
  assert(a !== b, 'timestamp khác phải cho chữ ký khác');
  const c = signShopeeRequest('testkey', '123456', '/api/v2/order/get_order_list', 1700000000);
  assert(a !== c, 'thiếu access_token/shop_id phải cho chữ ký khác (public ≠ shop-level)');
});

// ---------------------------------------------------------------------------
// 2. Authorize URL + pending authorization (Shopee không có state)
// ---------------------------------------------------------------------------
await test('authorize URL: đúng host production + partner_id + sign + redirect', () => {
  const url = buildShopeeAuthorizeUrl({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, redirectUri: 'https://achat.vn/auth/shopee/callback' });
  assert(url.startsWith('https://partner.shopeemobile.com/api/v2/shop/auth_partner?'), `host/path sai: ${url}`);
  assert(url.includes('partner_id=123456'), 'thiếu partner_id');
  assert(url.includes('sign='), 'thiếu sign');
  assert(url.includes('redirect=https%3A%2F%2Fachat.vn%2Fauth%2Fshopee%2Fcallback'), 'thiếu redirect');
});
await test('authorize URL sandbox: dùng host sandbox khi sandbox=true', () => {
  const url = buildShopeeAuthorizeUrl({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, redirectUri: 'https://achat.vn/auth/shopee/callback', host: SHOPEE_SANDBOX_HOST });
  assert(url.startsWith('https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner?'), `host sandbox sai: ${url}`);
});
await test('pending authorization: 1 pending duy nhất, consume dùng 1 lần', () => {
  const first = createShopeeAuthState('xinh');
  assert(first.ok, 'pending đầu tiên phải ok');
  const second = createShopeeAuthState('bedan');
  assert(second.ok === false, 'pending thứ 2 cùng lúc phải bị từ chối (Shopee không có state)');
  assert(String(second.error).includes('Kết nối Shopee'), 'thông báo phải rõ ràng');
  const consumed = consumeShopeeAuthState();
  assert(consumed?.shopKey === 'xinh', 'consume phải trả đúng shopKey');
  const gone = consumeShopeeAuthState();
  assert(gone === null, 'consume lần 2 phải trả null (dùng 1 lần)');
  const third = createShopeeAuthState('bedan');
  assert(third.ok, 'sau khi consume xong thì shop khác được tạo pending');
  consumeShopeeAuthState();
});

// ---------------------------------------------------------------------------
// 3. Verify chữ ký webhook (callbackUrl + "|" + body; fallback X-Shopee-Signature)
// ---------------------------------------------------------------------------
const CALLBACK_URL = 'https://achat.vn/webhook/shopee';
const RAW_BODY = JSON.stringify({ code: 3, shop_id: 789, timestamp: 1762755600, data: { order_sn: '240110ABC123' } });
const GOOD_AUTH = crypto.createHmac('sha256', PARTNER_KEY).update(`${CALLBACK_URL}|${RAW_BODY}`).digest('hex');
const GOOD_XSIG = crypto.createHmac('sha256', PARTNER_KEY).update(RAW_BODY).digest('hex');
await test('verify webhook: Authorization đúng → true', () => {
  eq(GOOD_AUTH, '1e1a0af7a165641489db8340f199f8ec02b0922299670653af81174ac3079c35', 'vector chữ ký push sai');
  assert(verifyShopeePushSignature(PARTNER_KEY, CALLBACK_URL, RAW_BODY, GOOD_AUTH, null) === true, 'phải verify được');
});
await test('verify webhook: fallback X-Shopee-Signature (chỉ body) → true', () => {
  assert(verifyShopeePushSignature(PARTNER_KEY, CALLBACK_URL, RAW_BODY, null, GOOD_XSIG) === true, 'fallback phải verify được');
});
await test('verify webhook: sai key / body bị sửa / thiếu header → false', () => {
  assert(verifyShopeePushSignature('sai-key', CALLBACK_URL, RAW_BODY, GOOD_AUTH, null) === false, 'sai key phải fail');
  assert(verifyShopeePushSignature(PARTNER_KEY, CALLBACK_URL, RAW_BODY + 'x', GOOD_AUTH, null) === false, 'body bị sửa phải fail');
  assert(verifyShopeePushSignature(PARTNER_KEY, CALLBACK_URL, RAW_BODY, null, null) === false, 'thiếu header phải fail');
  assert(verifyShopeePushSignature(PARTNER_KEY, 'https://evil.example/webhook', RAW_BODY, GOOD_AUTH, null) === false, 'sai callback URL phải fail');
  assert(verifyShopeePushSignature(PARTNER_KEY, CALLBACK_URL, RAW_BODY, 'deadbeef', null) === false, 'chữ ký lạ phải fail');
});

// ---------------------------------------------------------------------------
// 4. Đổi code / refresh token (expire_in là SỐ GIÂY, không phải timestamp tuyệt đối)
// ---------------------------------------------------------------------------
await test('exchangeAuthCode: parse token + expire_in 14400s (4h)', async () => {
  mockHandler = (url, init) => {
    assert(url.startsWith('https://partner.shopeemobile.com/api/v2/auth/token/get'), `host/path sai: ${url}`);
    assert(init?.method === 'POST', 'token/get phải là POST');
    const body = JSON.parse(init.body);
    eq(body.partner_id, 123456, 'partner_id phải là số');
    eq(body.code, 'CODE-1', 'code sai');
    eq(body.shop_id, 789, 'shop_id phải là số');
    assert(typeof body.sign === 'string' && body.sign.length === 64, 'thiếu sign HMAC');
    return okBody({ access_token: 'AT-1', refresh_token: 'RT-1', expire_in: 14400, shop_id_list: ['789'] });
  };
  const r = await exchangeShopeeAuthCode({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, code: 'CODE-1', shopId: '789' });
  assert(r.ok, `đổi code phải ok: ${r.ok ? '' : (r as any).error}`);
  if (r.ok) {
    eq(r.data.accessToken, 'AT-1', 'access token sai');
    eq(r.data.refreshToken, 'RT-1', 'refresh token sai');
    eq(r.data.expireIn, 14400, 'expire_in phải là 14400 giây (4h), KHÔNG phải timestamp tuyệt đối');
  }
});
await test('exchangeAuthCode: error envelope Shopee → lỗi rõ ràng', async () => {
  mockHandler = () => errBody('error_auth', 'Invalid code');
  const r = await exchangeShopeeAuthCode({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, code: 'BAD', shopId: '789' });
  assert(r.ok === false, 'code sai phải lỗi');
  if (!r.ok) assert(r.error.includes('error_auth'), `thông báo phải giữ mã lỗi Shopee: ${r.error}`);
});
await test('refreshAccessToken: trả cả refresh token mới (xoay vòng)', async () => {
  mockHandler = (url, init) => {
    assert(url.includes('/api/v2/auth/access_token/get'), `path sai: ${url}`);
    assert(init?.method === 'POST', 'access_token/get phải là POST');
    const body = JSON.parse(init.body);
    eq(body.refresh_token, 'RT-1', 'refresh token sai');
    return okBody({ access_token: 'AT-2', refresh_token: 'RT-2', expire_in: 14400 });
  };
  const r = await refreshShopeeAccessToken({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, refreshToken: 'RT-1', shopId: '789' });
  assert(r.ok, 'refresh phải ok');
  if (r.ok) { eq(r.data.accessToken, 'AT-2', 'access token mới sai'); eq(r.data.refreshToken, 'RT-2', 'refresh token mới phải được lưu lại (xoay vòng)'); }
});

// ---------------------------------------------------------------------------
// 5. Map trạng thái + gom line item + map đơn
// ---------------------------------------------------------------------------
await test('map trạng thái: đủ 9 trạng thái Shopee', () => {
  const cases: Array<[string, string]> = [
    ['UNPAID', 'cho_duyet'], ['PENDING', 'cho_duyet'], ['READY_TO_SHIP', 'cho_dong_goi'],
    ['PROCESSED', 'cho_lay_hang'], ['INVOICE_PENDING', 'cho_lay_hang'],
    ['SHIPPED', 'dang_giao_hang'], ['COMPLETED', 'da_giao_hang'],
    ['IN_CANCEL', 'cho_duyet'], ['CANCELLED', 'da_huy'],
  ];
  for (const [input, want] of cases) eq(mapShopeeOrderStatus(input), want, `map ${input}`);
});
await test('gom line item: 3 entry cùng model → 1 dòng qty 3', () => {
  const grouped = groupShopeeLineItems(MOCK_VN_ORDER.item_list!);
  eq(grouped.length, 1, 'phải gom thành 1 dòng');
  eq(grouped[0].quantity, 3, 'qty phải là 3');
  eq(grouped[0].modelSku, 'DQN-DEN-36', 'model_sku sai');
  eq(grouped[0].unitPrice, 50000, 'đơn giá sai');
});
await test('parse tên model: "Đen, 36" → màu Đen, size 36', () => {
  const p = parseShopeeSkuName('Đen, 36');
  eq(p.color, 'Đen', 'màu sai');
  eq(p.size, '36', 'size sai');
  const p2 = parseShopeeSkuName('Nâu / 37');
  eq(p2.color, 'Nâu', 'màu (dấu /) sai');
  eq(p2.size, '37', 'size (dấu /) sai');
});
await test('map đơn VN: tiền VND, COD, model_sku khớp catalogue', () => {
  const { order, masked, unmappedSkus } = mapShopeeOrderToOrderInput(MOCK_VN_ORDER, 'xinh', [], [{ sku: 'DQN-DEN-36', color: 'Đen', size: '36', productId: 'p-dqn' }]);
  eq(order.items.length, 1, 'phải có 1 dòng hàng');
  eq(order.items[0].quantity, 3, 'qty 3');
  eq(order.items[0].sku, 'DQN-DEN-36', 'sku sai');
  eq(order.items[0].color, 'Đen', 'màu sai');
  eq(order.items[0].size, '36', 'size sai');
  eq(order.goodsTotal, 150000, 'tiền hàng sai');
  eq(order.totalAmount, 150000, 'tổng sai');
  eq(order.remainingCod, 150000, 'COD phải = tổng khi payment_method là Cash on Delivery');
  eq(masked, false, 'SĐT thật thì masked phải false');
  eq(order.customerPhone, '0912345678', 'SĐT sai');
  eq(order.carrier, 'Shopee Express', 'hãng vận chuyển phải là của Shopee');
  eq(order.waybillCode, 'SPXVN123456789', 'mã vận đơn sai');
  eq(unmappedSkus.length, 0, 'SKU đã khớp catalogue thì không unmapped');
  assert(order.note.includes('240110ABC123'), 'ghi chú phải có mã đơn sàn');
  eq(shopeeMoneyToVnd(150000), 150000, 'tiền Shopee là số VND, không phải cents');
});
await test('map đơn: SĐT bị che → masked true, không upsert khách', () => {
  const maskedOrder: ShopeeOrderDetail = {
    ...MOCK_VN_ORDER,
    recipient_address: { ...MOCK_VN_ORDER.recipient_address, name: 'N*** A', phone: '091***5678' },
  };
  assert(shopeeIsMasked('091***5678') === true, 'SĐT che phải nhận ra');
  const { masked } = mapShopeeOrderToOrderInput(maskedOrder, 'xinh', [], []);
  eq(masked, true, 'masked phải true');
  eq(shopeeMoneyToVnd('149000'), 149000, 'tiền chuỗi số sai');
});

// ---------------------------------------------------------------------------
// 6. upsert đơn: tạo rồi cập nhật, không trùng
// ---------------------------------------------------------------------------
await test('upsertShopeeOrder: tạo mới rồi cập nhật trạng thái, không trùng đơn', () => {
  const state = fakeState();
  const skuMaps: any[] = [];
  const variants = [{ sku: 'DQN-DEN-36', color: 'Đen', size: '36', productId: 'p-dqn' }];
  const first = upsertShopeeOrder(state, MOCK_VN_ORDER, 'xinh', skuMaps, variants);
  eq(first.action, 'created', 'lần đầu phải tạo mới');
  assert(first.order.code.startsWith('ACH77'), `mã đơn sai: ${first.order.code}`);
  eq((first.order as any).source, 'shopee', 'source phải là shopee');
  eq((first.order as any).capiStatus, 'chua_ket_noi', 'đơn Shopee không báo CAPI');
  eq((first.order as any).shopeeOrderSn, '240110ABC123', 'thiếu mã đơn sàn');
  eq(state.orders.length, 1, 'phải có đúng 1 đơn');
  eq(state.customers.length, 1, 'SĐT thật phải upsert khách');
  const shipped = { ...MOCK_VN_ORDER, order_status: 'SHIPPED', update_time: 1762759200 };
  const second = upsertShopeeOrder(state, shipped, 'xinh', skuMaps, variants);
  eq(second.action, 'updated', 'lần hai phải cập nhật');
  eq(second.order.code, first.order.code, 'mã đơn phải giữ nguyên');
  eq(state.orders.length, 1, 'không được tạo trùng đơn');
  eq(second.order.orderStatus, 'dang_giao_hang', 'trạng thái phải đổi sang đang giao');
  const cancelled = { ...MOCK_VN_ORDER, order_status: 'CANCELLED', update_time: 1762762800 };
  const third = upsertShopeeOrder(state, cancelled, 'xinh', skuMaps, variants);
  eq(third.order.orderStatus, 'da_huy', 'sàn báo hủy thì đơn phải theo sàn');
  const found = findOrderByShopeeSn(state.orders, '240110ABC123');
  assert(found?.code === first.order.code, 'findOrderByShopeeSn phải tìm được đơn');
});

// ---------------------------------------------------------------------------
// 7. Order list / detail qua mock (envelope Shopee)
// ---------------------------------------------------------------------------
await test('getShopeeOrderList: query đúng + parse more/next_cursor', async () => {
  mockHandler = (url) => {
    assert(url.includes('/api/v2/order/get_order_list'), `path sai: ${url}`);
    assert(url.includes('partner_id=123456'), 'thiếu partner_id');
    assert(url.includes('access_token=AT-1'), 'thiếu access_token');
    assert(url.includes('shop_id=789'), 'thiếu shop_id');
    assert(url.includes('time_range_field=update_time'), 'thiếu time_range_field');
    return okBody({ order_list: [{ order_sn: '240110ABC123', order_status: 'READY_TO_SHIP' }], more: true, next_cursor: 'CUR-1' });
  };
  const r = await getShopeeOrderList(shopeeCall(), { timeFrom: 1762000000, timeTo: 1762755600 });
  assert(r.ok, 'lấy danh sách đơn phải ok');
  if (r.ok) {
    eq(r.data.order_list?.length, 1, 'phải có 1 đơn');
    eq(r.data.more, true, 'more phải true');
    eq(r.data.next_cursor, 'CUR-1', 'next_cursor sai');
  }
});
await test('getShopeeOrderDetail: tối đa 50 mã, order_sn_list đúng', async () => {
  mockHandler = (url) => {
    assert(url.includes('/api/v2/order/get_order_detail'), `path sai: ${url}`);
    assert(url.includes('order_sn_list=240110ABC123'), 'thiếu order_sn_list');
    return okBody({ order_list: [MOCK_VN_ORDER] });
  };
  const r = await getShopeeOrderDetail(shopeeCall(), ['240110ABC123']);
  assert(r.ok, 'lấy chi tiết đơn phải ok');
  if (r.ok) eq(r.data.order_list?.[0].order_sn, '240110ABC123', 'order_sn sai');
});

// ---------------------------------------------------------------------------
// 8. Webhook dedupe + action handlers với fake state
// ---------------------------------------------------------------------------
await test('webhook dedupe: cùng body → cùng key, khác body → khác key', () => {
  const k1 = shopeeWebhookDedupeKey(RAW_BODY);
  const k2 = shopeeWebhookDedupeKey(RAW_BODY);
  const k3 = shopeeWebhookDedupeKey(RAW_BODY + ' ');
  eq(k1, k2, 'cùng body phải cùng key');
  assert(k1 !== k3, 'khác body phải khác key');
  eq(k1.length, 64, 'key phải là SHA-256 hex (64 ký tự)');
});

await test('action saveshopeeplatformconfig/getshopeeplatformconfig: chỉ Super Admin, key không lộ', async () => {
  const state = fakeState();
  const saved = await handleAction(state, 'saveshopeeplatformconfig', {
    config: {
      partnerId: PARTNER_ID, partnerKey: PARTNER_KEY,
      redirectUri: 'https://achat.vn/auth/shopee/callback',
      webhookUrl: 'https://achat.vn/webhook/shopee',
    },
  }, superCtx);
  assert(saved.ok, `lưu app chung phải ok: ${saved.error ?? ''}`);
  eq((saved as any).platform.configured, true, 'đủ partner_id/key thì configured phải true');
  const got = await handleAction(state, 'getshopeeplatformconfig', {}, superCtx);
  assert(got.ok, 'đọc app chung phải ok');
  const platform = (got as any).platform;
  assert(typeof platform.partnerId === 'string' && platform.partnerId.includes('*'), 'partnerId trả về phải bị che');
  assert(!('partnerKey' in platform) || !platform.partnerKey, 'partnerKey không được trả về');
  eq(platform.configured, true, 'configured phải true');
  eq(platform.sandbox, false, 'mặc định không phải sandbox');
  // Shop thường gọi cũng bị chặn.
  const shopTry = await handleAction(state, 'getshopeeplatformconfig', {}, ctx);
  assert(shopTry.ok === false, 'shop thường không được đọc app chung');
  assert(String(shopTry.error).includes('Super Admin'), `phải báo chỉ Super Admin: ${shopTry.error}`);
  const shopSave = await handleAction(state, 'saveshopeeplatformconfig', { config: { partnerId: 'x' } }, ctx);
  assert(shopSave.ok === false, 'shop thường không được lưu app chung');
});
await test('action saveshopeeplatformconfig: URL sai → từ chối (http ngoài localhost, query, không phải URL)', async () => {
  const state = fakeState();
  const bad1 = await handleAction(state, 'saveshopeeplatformconfig', { config: { redirectUri: 'http://example.com/cb' } }, superCtx);
  assert(bad1.ok === false, 'http ngoài localhost phải bị từ chối');
  const bad2 = await handleAction(state, 'saveshopeeplatformconfig', { config: { webhookUrl: 'https://achat.vn/webhook/shopee?x=1' } }, superCtx);
  assert(bad2.ok === false, 'URL có query phải bị từ chối');
  const bad3 = await handleAction(state, 'saveshopeeplatformconfig', { config: { redirectUri: 'not-a-url' } }, superCtx);
  assert(bad3.ok === false, 'chuỗi không phải URL phải bị từ chối');
  const good = await handleAction(state, 'saveshopeeplatformconfig', { config: { redirectUri: 'http://localhost:3000/auth/shopee/callback' } }, superCtx);
  assert(good.ok === true, 'http://localhost được phép để test local');
});
await test('shopeePlatformPublic: che partnerId, báo tuổi partner_key', () => {
  const pub = shopeePlatformPublic({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, redirectUri: '', webhookUrl: '', partnerKeyCreatedAt: new Date().toISOString() });
  eq(pub.configured, true, 'configured phải true');
  assert(String(pub.partnerId).includes('*'), 'partnerId phải bị che');
  assert(!('partnerKey' in pub), 'partnerKey không được có trong public');
  eq(pub.partnerKeyResetDue, false, 'key mới tạo thì chưa tới hạn reset');
  const old = shopeePlatformPublic({ partnerId: PARTNER_ID, partnerKey: PARTNER_KEY, redirectUri: '', webhookUrl: '', partnerKeyCreatedAt: new Date(Date.now() - 170 * 86400000).toISOString() });
  eq(old.partnerKeyResetDue, true, 'key 170 ngày tuổi phải báo sắp tới hạn reset (180 ngày)');
});
await test('action getshopeechannels: trả 2 kênh + platformConfigured theo app chung + chatSupported false', async () => {
  const state = fakeState();
  const r0 = await handleAction(state, 'getshopeechannels', {}, ctx);
  assert(r0.ok, 'getshopeechannels phải ok');
  const ch0 = (r0 as any).channels;
  eq(ch0.length, 2, 'phải có 2 kênh');
  eq(ch0[0].id, 'shopee', 'kênh đầu phải là shopee');
  eq(ch0[0].status, 'disconnected', 'chưa kết nối thì disconnected');
  eq(ch0[0].platformConfigured, false, 'chưa có app chung thì platformConfigured false');
  eq(ch0[0].hasConfig, false, 'chưa có app chung thì hasConfig false');
  eq(ch0[0].chatSupported, false, 'Chat API Shopee đã đóng — chatSupported phải false');
  assert(String(ch0[0].chatNote).includes('Seller Center'), 'phải ghi chú trả lời tay trong Seller Center');
  state.shopeePlatform = platformApp();
  const r1 = await handleAction(state, 'getshopeechannels', {}, ctx);
  eq((r1 as any).channels[0].platformConfigured, true, 'đã có app chung thì platformConfigured true');
  eq((r1 as any).channels[0].hasConfig, true, 'đã có app chung thì hasConfig true');
  eq((r1 as any).channels[0].webhookUrl, 'https://achat.vn/webhook/shopee', 'webhook URL lấy từ app chung');
});
await test('action getshopeeoauthurl: chưa cấu hình app chung → lỗi rõ ràng; đã cấu hình → trả URL', async () => {
  const state = fakeState();
  const r = await handleAction(state, 'getshopeeoauthurl', {}, ctx);
  assert(r.ok === false, 'chưa cấu hình app chung phải lỗi');
  assert(String(r.error).includes('App Shopee chung'), `thông báo phải rõ ràng: ${r.error}`);
  state.shopeePlatform = platformApp();
  const r2 = await handleAction(state, 'getshopeeoauthurl', {}, ctx);
  assert(r2.ok, `đã cấu hình app chung phải trả URL: ${r2.error ?? ''}`);
  assert(String((r2 as any).url).includes('partner_id=123456'), 'URL phải có partner_id của app chung');
  assert(String((r2 as any).url).startsWith('https://partner.shopeemobile.com/api/v2/shop/auth_partner?'), 'host/path authorize sai');
  // Dọn pending để test sau không bị kẹt.
  consumeShopeeAuthState();
});
await test('action disconnectshopee: chỉ xóa token shop, app chung còn nguyên', async () => {
  const state = fakeState();
  state.shopeePlatform = platformApp();
  (state.shops[0] as any).shopee = connectedShopShopee();
  const r = await handleAction(state, 'disconnectshopee', {}, ctx);
  assert(r.ok, 'ngắt kết nối phải ok');
  const s = (state.shops[0] as any).shopee;
  eq(s.status, 'disconnected', 'status shop phải disconnected');
  eq(s.accessToken, '', 'access token shop phải bị xóa');
  eq(s.refreshToken, '', 'refresh token shop phải bị xóa');
  eq(state.shopeePlatform.partnerId, PARTNER_ID, 'partnerId app chung không được đụng tới');
  eq(state.shopeePlatform.partnerKey, PARTNER_KEY, 'partnerKey app chung không được đụng tới');
});
await test('đổi partner_id app chung → token các shop bị xóa (phải ủy quyền lại)', async () => {
  const state = fakeState();
  state.shopeePlatform = platformApp();
  (state.shops[0] as any).shopee = connectedShopShopee();
  const r = await handleAction(state, 'saveshopeeplatformconfig', { config: { partnerId: '999999', partnerKey: PARTNER_KEY } }, superCtx);
  assert(r.ok, 'lưu app chung mới phải ok');
  assert((r as any).tokensCleared === true, 'đổi partner_id phải báo tokensCleared');
  const s = (state.shops[0] as any).shopee;
  eq(s.status, 'disconnected', 'token shop phải bị xóa khi đổi app chung');
  eq(s.accessToken, '', 'access token shop phải bị xóa');
  // Lưu lại cùng partner_id thì KHÔNG xóa token.
  (state.shops[0] as any).shopee = connectedShopShopee();
  const r2 = await handleAction(state, 'saveshopeeplatformconfig', { config: { redirectUri: 'https://achat.vn/auth/shopee/callback' } }, superCtx);
  assert(r2.ok, 'lưu lại cùng partner_id phải ok');
  assert((r2 as any).tokensCleared === false, 'không đổi partner_id thì không xóa token');
  eq((state.shops[0] as any).shopee.status, 'connected', 'token shop phải còn nguyên');
});
await test('action syncshopeeorders: list + detail → tạo đơn, dedupe theo order_sn', async () => {
  const state = fakeState();
  state.shopeePlatform = platformApp();
  (state.shops[0] as any).shopee = connectedShopShopee();
  mockHandler = (url) => {
    if (url.includes('/api/v2/order/get_order_list')) {
      return okBody({ order_list: [{ order_sn: '240110ABC123', order_status: 'READY_TO_SHIP' }], more: false, next_cursor: '' });
    }
    if (url.includes('/api/v2/order/get_order_detail')) {
      return okBody({ order_list: [MOCK_VN_ORDER] });
    }
    throw new Error(`URL không mong đợi: ${url}`);
  };
  const r = await handleAction(state, 'syncshopeeorders', { daysBack: 7 }, ctx);
  assert(r.ok, `sync đơn phải ok: ${r.error ?? ''}`);
  eq((r as any).fetched, 1, 'phải lấy 1 đơn');
  eq((r as any).created, 1, 'phải tạo 1 đơn mới');
  eq(state.orders.length, 1, 'phải có 1 đơn trong state');
  eq((state.orders[0] as any).shopeeOrderSn, '240110ABC123', 'đơn phải lưu order_sn');
  // Sync lần 2 → cập nhật, không trùng.
  const r2 = await handleAction(state, 'syncshopeeorders', { daysBack: 7 }, ctx);
  assert(r2.ok, 'sync lần 2 phải ok');
  eq((r2 as any).created, 0, 'lần 2 không được tạo mới');
  eq((r2 as any).updated, 1, 'lần 2 phải cập nhật');
  eq(state.orders.length, 1, 'không được tạo trùng đơn');
});
await test('action shopeewebhookreceive: verify + lưu + xử lý đơn, lần 2 trùng → duplicate', async () => {
  const state = fakeState();
  // App chung đã cấu hình + shop đã kết nối dưới app chung (token còn hạn xa để không refresh).
  state.shopeePlatform = platformApp();
  (state.shops[0] as any).shopee = connectedShopShopee();
  mockHandler = (url) => {
    assert(url.includes('/api/v2/order/get_order_detail'), `phải gọi getOrderDetail: ${url}`);
    return okBody({ order_list: [MOCK_VN_ORDER] });
  };
  const args = { rawBody: RAW_BODY, authorization: GOOD_AUTH, callbackUrl: CALLBACK_URL };
  const first = await handleAction(state, 'shopeewebhookreceive', args, ctx);
  assert(first.ok, `webhook lần 1 phải ok: ${first.error ?? ''}`);
  assert((first as any).processed === true, 'phải xử lý được event');
  assert(typeof (first as any).orderCode === 'string' && (first as any).orderCode.startsWith('ACH77'), 'phải tạo đơn app');
  eq(state.orders.length, 1, 'phải có 1 đơn sau webhook');
  const second = await handleAction(state, 'shopeewebhookreceive', args, ctx);
  assert(second.ok && (second as any).duplicate === true, 'lần 2 cùng body phải là duplicate');
  eq(state.orders.length, 1, 'duplicate không được tạo thêm đơn');
});
await test('action shopeewebhookreceive: push code 12 → cảnh báo hết hạn ủy quyền', async () => {
  const state = fakeState();
  state.shopeePlatform = platformApp();
  (state.shops[0] as any).shopee = connectedShopShopee();
  const body12 = JSON.stringify({ code: 12, shop_id: 789, timestamp: 1762755600, data: {} });
  const sig12 = crypto.createHmac('sha256', PARTNER_KEY).update(`${CALLBACK_URL}|${body12}`).digest('hex');
  const r = await handleAction(state, 'shopeewebhookreceive', { rawBody: body12, authorization: sig12, callbackUrl: CALLBACK_URL }, ctx);
  assert(r.ok, `push code 12 phải ok: ${r.error ?? ''}`);
  assert((r as any).processed === true, 'push code 12 phải được xử lý');
  eq((state.shops[0] as any).shopee.authExpiryWarning, true, 'phải bật cảnh báo hết hạn ủy quyền');
});
await test('handleShopeePush trực tiếp: chữ ký sai → 401-style fail', async () => {
  const state = fakeState();
  state.shopeePlatform = platformApp();
  (state.shops[0] as any).shopee = { status: 'connected', shopId: '789' };
  const r = await handleShopeePush(state, { rawBody: RAW_BODY, authorization: 'deadbeef', callbackUrl: CALLBACK_URL });
  assert(r.ok === false, 'chữ ký sai phải fail');
});

// ---------------------------------------------------------------------------
// Tổng kết
// ---------------------------------------------------------------------------
console.log(`\nShopee test: ${passed} passed, ${failed} failed${failures.length ? ` — lỗi: ${failures.join(', ')}` : ''}`);
if (failed > 0) process.exit(1);
