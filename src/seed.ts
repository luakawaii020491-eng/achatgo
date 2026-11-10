// seed.ts — Dữ liệu khởi tạo ban đầu cho AChatGo standalone (v38).
// CHỈ seed dữ liệu KHÔNG chứa thông tin cá nhân thật: shop, catalogue sản
// phẩm, quy tắc ship, cấu hình SaaS/loyalty/giao hàng, hãng vận chuyển.
// TUYỆT ĐỐI KHÔNG có: SĐT/địa chỉ/tên khách hàng thật, nội dung hội thoại,
// đơn hàng thật, token/khóa API thật, ảnh base64 thật.
// Tài khoản shop (chủ shop/nhân viên) KHÔNG seed ở đây — được tạo qua luồng
// duyệt đăng ký dùng thử, mật khẩu băm bcrypt ngay lúc tạo.
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';
import type { Product, ShipFeeRule, State, Variant } from './types.js';
import { createEmptyState } from './store.js';

export const SEED_VERSION = 'v38';

/**
 * Mật khẩu Super Admin mặc định.
 * - Mặc định: mật khẩu TẠM sinh ngẫu nhiên mỗi lần seed, chỉ in 1 lần ra
 *   log server lúc khởi tạo (server.ts), KHÔNG ghi cứng trong code (repo
 *   public mà ghi mật khẩu mặc định thì ai cũng vào được). Đổi ngay lần
 *   đăng nhập đầu tiên (mustChangePassword = true).
 * - TẠM THỜI (theo yêu cầu chủ shop 2026-11-10): nếu đặt biến môi trường
 *   SUPER_ADMIN_PASSWORD (>= 6 ký tự) thì dùng luôn mật khẩu đó làm mật
 *   khẩu cố định, mustChangePassword = false, KHÔNG in giá trị ra log —
 *   để restart/re-seed không đổi mật khẩu nữa. Khi chạy thật thì đổi mật
 *   khẩu này (đặt lại env var hoặc đổi mật khẩu trong app rồi xóa env).
 *   Env var đặt mà ngắn hơn 6 ký tự thì throw lỗi, server dừng.
 */
export let generatedAdminPassword = '';

function newAdminTempPassword(): string {
  return 'Admin-' + randomBytes(9).toString('base64url');
}

/** Mật khẩu Super Admin sẽ dùng khi seed: cố định từ env (nếu có) hoặc tạm ngẫu nhiên. */
export function resolveAdminPassword(): { password: string; fixed: boolean } {
  const fixed = process.env.SUPER_ADMIN_PASSWORD;
  if (fixed !== undefined) {
    if (fixed.length < 6) throw new Error('SUPER_ADMIN_PASSWORD tối thiểu 6 ký tự.');
    return { password: fixed, fixed: true };
  }
  return { password: newAdminTempPassword(), fixed: false };
}

export interface AdminPasswordAuth {
  verifyPassword: (password: string, passwordHash: string) => boolean;
  hashPassword: (password: string) => string;
}

/**
 * Đồng bộ tài khoản Super Admin HIỆN CÓ về mật khẩu cố định từ env (khi
 * SUPER_ADMIN_PASSWORD được đặt): đặt lại hash + tắt cờ đổi mật khẩu.
 * Trả về true nếu có thay đổi (caller lưu state). Không có env var, không
 * có tài khoản SA, hoặc tài khoản đã đúng thì trả false. Env var ngắn
 * hơn 6 ký tự thì throw.
 */
export function reconcileFixedAdminPassword(state: State, auth: AdminPasswordAuth): boolean {
  const fixed = process.env.SUPER_ADMIN_PASSWORD;
  if (fixed === undefined) return false;
  if (fixed.length < 6) throw new Error('SUPER_ADMIN_PASSWORD tối thiểu 6 ký tự.');
  const sa = state.accounts.find((a) => a.role === 'super_admin');
  if (!sa) return false;
  if (sa.mustChangePassword === false && auth.verifyPassword(fixed, sa.passwordHash)) return false;
  sa.passwordHash = auth.hashPassword(fixed);
  sa.mustChangePassword = false;
  return true;
}

interface ColorDef {
  code: string;
  name: string;
}

/** Sinh các biến thể màu x size cho một sản phẩm. */
function buildVariants(
  skuPrefix: string,
  colors: ColorDef[],
  sizes: string[],
  costPrice = 0,
): Variant[] {
  const variants: Variant[] = [];
  for (const color of colors) {
    for (const size of sizes) {
      variants.push({
        sku: `${skuPrefix}-${color.code}-${size}`,
        color: color.name,
        size,
        // -1 = không quản lý tồn kho.
        stock: -1,
        // 0 = chưa có giá vốn thật (không bịa số).
        costPrice,
      });
    }
  }
  return variants;
}

const COLORS_3: ColorDef[] = [
  { code: 'DEN', name: 'Đen' },
  { code: 'KEM', name: 'Kem' },
  { code: 'NAU', name: 'Nâu' },
];

/** Một quy tắc phí ship theo khoảng số lượng. */
function qtyRule(
  id: string,
  name: string,
  scope: ShipFeeRule['scope'],
  groupName: string | null,
  productId: string | null,
  minQty: number,
  maxQty: number | null,
  fee: number,
): ShipFeeRule {
  return { id, name, scope, groupName, productId, minQty, maxQty, fee, enabled: true };
}

/** Catalogue 5 sản phẩm v37 (KHÔNG kèm dữ liệu khách hàng). */
function seedProducts(): Product[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'prod-dqn',
      shopKey: 'xinh',
      name: 'DÉP QUAI NGANG',
      groupName: 'Quai ngang',
      price: 50000,
      image: '',
      variants: buildVariants('DQN', COLORS_3, ['36', '37', '38', '39']),
      createdAt: now,
    },
    {
      id: 'prod-ddc7p',
      // ĐẸP + chưa có shop nên sản phẩm để shopKey 'shared' — chỉ Super Admin
      // thấy, shop thường không thấy (xem scopeState).
      shopKey: 'shared',
      name: 'DÉP ĐẾ CAO 7 PHÂN',
      groupName: 'Đế cao 7 phân',
      price: 75000,
      image: '',
      variants: buildVariants(
        'DDC7P',
        [
          { code: 'DEN', name: 'Đen' },
          { code: 'XAM', name: 'Xám' },
          { code: 'TRANG', name: 'Trắng' },
        ],
        ['3637', '3839'],
      ),
      createdAt: now,
    },
    {
      id: 'prod-bedan3p',
      shopKey: 'bedan',
      name: 'SỤC 3 PHÂN',
      groupName: 'Sục 3 phân',
      price: 50000,
      image: '',
      variants: buildVariants('BEDAN-3P', COLORS_3, ['36', '37', '38', '39', '40']),
      createdAt: now,
    },
    {
      id: 'prod-drdl',
      shopKey: 'bedan',
      name: 'DÉP RỌ ĐAN LƯỚI',
      groupName: 'Rọ đan lưới',
      price: 50000,
      image: '',
      variants: buildVariants('DRDL', COLORS_3, ['36', '37', '38', '39', '40']),
      createdAt: now,
    },
    {
      id: 'prod-skl',
      shopKey: 'hana',
      name: 'SỤC KHOÉT LỖ',
      groupName: 'Sục khoét lỗ',
      price: 65000,
      image: '',
      variants: buildVariants('SKL', COLORS_3, ['36', '37', '38', '39', '40']),
      createdAt: now,
    },
  ];
}

/**
 * Seed state khởi tạo. Gọi 1 lần khi chưa có file dữ liệu; không gọi đè
 * lên dữ liệu đang chạy (sẽ mất đơn/khách đã có).
 */
export function seedInitialState(): State {
  const state = createEmptyState();
  const now = new Date().toISOString();

  // 4 shop v37: tên / gói / hạn mức. lua123 dùng thử 7 ngày, hết 16/11/2026.
  state.shops = [
    {
      key: 'lua123',
      name: 'lua123',
      domain: 'lua123.achat.vn',
      plan: 'dung-thu',
      pageLimit: 1,
      staffLimit: 1,
      trialEndsAt: '2026-11-16T00:00:00+07:00',
      status: 'trial',
      createdAt: now,
    },
    {
      key: 'xinh',
      name: 'DÉP XINH',
      domain: 'xinh.achat.vn',
      plan: 'pro',
      pageLimit: 5,
      staffLimit: 10,
      trialEndsAt: null,
      status: 'active',
      createdAt: now,
    },
    {
      key: 'bedan',
      name: 'Shop Bé Đan',
      domain: 'bedan.achat.vn',
      plan: 'pro',
      pageLimit: 5,
      staffLimit: 10,
      trialEndsAt: null,
      status: 'active',
      createdAt: now,
    },
    {
      key: 'hana',
      name: 'Dép Hana',
      domain: 'hana.achat.vn',
      plan: 'pro',
      pageLimit: 5,
      staffLimit: 10,
      trialEndsAt: null,
      status: 'active',
      createdAt: now,
    },
  ];

  // Tài khoản Super Admin mặc định. Mật khẩu TẠM sinh ngẫu nhiên, băm bằng
  // bcrypt ngay lúc seed — hash của artifact Muse không xuất được nên
  // tài khoản cũ phải đặt lại mật khẩu khi lên Render. Đổi mật khẩu này
  // ngay lần đăng nhập đầu tiên (mustChangePassword = true).
  // Nếu đặt SUPER_ADMIN_PASSWORD thì dùng mật khẩu cố định đó (xem
  // resolveAdminPassword ở đầu file) và tắt cờ đổi mật khẩu.
  const adminPw = resolveAdminPassword();
  generatedAdminPassword = adminPw.password;
  state.accounts = [
    {
      id: 'acc-super-admin',
      email: 'admin@achat.vn',
      username: 'admin',
      passwordHash: hashPassword(adminPw.password),
      role: 'super_admin',
      shopKey: null,
      displayName: 'Super Admin',
      mustChangePassword: !adminPw.fixed,
      createdAt: now,
    },
  ];

  state.products = seedProducts();

  // Quy tắc phí ship THEO SHOP (v37). lua123 trống hoàn toàn (0 quy tắc).
  state.shipFeeRulesByShop = {
    lua123: [],
    xinh: [
      qtyRule('xinh-quai-1', 'Quai ngang 1 đôi ship 30k', 'group', 'Quai ngang', null, 1, 1, 30000),
      qtyRule('xinh-quai-2', 'Quai ngang từ 2 đôi miễn ship', 'group', 'Quai ngang', null, 2, null, 0),
      qtyRule('xinh-all-1', 'Mọi sản phẩm khác 1 SP ship 30k', 'all', '', null, 1, 1, 30000),
      qtyRule('xinh-all-2', 'Mọi sản phẩm khác từ 2 SP miễn ship', 'all', '', null, 2, null, 0),
    ],
    hana: [
      qtyRule('hana-skl-1', 'Sục khoét lỗ 1 đôi ship 25k', 'group', 'Sục khoét lỗ', null, 1, 1, 25000),
      qtyRule('hana-skl-2', 'Sục khoét lỗ từ 2 đôi miễn ship', 'group', 'Sục khoét lỗ', null, 2, null, 0),
      qtyRule('hana-all-1', 'Mọi sản phẩm khác 1 SP ship 30k', 'all', '', null, 1, 1, 30000),
      qtyRule('hana-all-2', 'Mọi sản phẩm khác từ 2 SP miễn ship', 'all', '', null, 2, null, 0),
    ],
    bedan: [
      qtyRule('bedan-3p-1', 'Sục 3 phân 1 đôi ship 30k', 'group', 'Sục 3 phân', null, 1, 1, 30000),
      qtyRule('bedan-3p-2', 'Sục 3 phân từ 2 đôi miễn ship', 'group', 'Sục 3 phân', null, 2, null, 0),
      qtyRule('bedan-drdl-1', 'Rọ đan lưới 1 đôi ship 30k', 'group', 'Rọ đan lưới', null, 1, 1, 30000),
      qtyRule('bedan-drdl-2', 'Rọ đan lưới từ 2 đôi miễn ship', 'group', 'Rọ đan lưới', null, 2, null, 0),
      qtyRule('bedan-all-1', 'Mọi sản phẩm khác 1 SP ship 30k', 'all', '', null, 1, 1, 30000),
      qtyRule('bedan-all-2', 'Mọi sản phẩm khác từ 2 SP miễn ship', 'all', '', null, 2, null, 0),
    ],
  };

  // Danh sách toàn cục (Super Admin test, khớp bản artifact v38: 12 rule —
  // 5 nhóm sản phẩm + cặp fallback). Shop nào cũng có cặp fallback của
  // riêng mình ở trên; danh sách này là nguồn dự phòng khi shop chưa có rule.
  state.shipFeeRules = [
    qtyRule('rule-type-0-fee', 'Dép quai ngang — mua 1 sản phẩm: phí ship 30.000đ', 'group', 'Quai ngang', '', 1, 1, 30000),
    qtyRule('rule-type-0-free', 'Dép quai ngang — mua từ 2 sản phẩm: miễn ship', 'group', 'Quai ngang', '', 2, null, 0),
    qtyRule('rule-type-1-fee', 'Sục khoét lỗ — mua 1 sản phẩm: phí ship 25.000đ', 'group', 'Sục khoét lỗ', '', 1, 1, 25000),
    qtyRule('rule-type-1-free', 'Sục khoét lỗ — mua từ 2 sản phẩm: miễn ship', 'group', 'Sục khoét lỗ', '', 2, null, 0),
    qtyRule('rule-type-2-fee', 'Sục 3 phân — mua 1 sản phẩm: phí ship 30.000đ', 'group', 'Sục 3 phân', '', 1, 1, 30000),
    qtyRule('rule-type-2-free', 'Sục 3 phân — mua từ 2 sản phẩm: miễn ship', 'group', 'Sục 3 phân', '', 2, null, 0),
    qtyRule('rule-type-3-fee', 'Dép rọ đan lưới — mua 1 sản phẩm: phí ship 30.000đ', 'group', 'Rọ đan lưới', '', 1, 1, 30000),
    qtyRule('rule-type-3-free', 'Dép rọ đan lưới — mua từ 2 sản phẩm: miễn ship', 'group', 'Rọ đan lưới', '', 2, null, 0),
    qtyRule('rule-type-4-fee', 'Dép đế cao 7 phân — mua 1 sản phẩm: phí ship 25.000đ', 'group', 'Đế cao 7 phân', '', 1, 1, 25000),
    qtyRule('rule-type-4-free', 'Dép đế cao 7 phân — mua từ 2 sản phẩm: miễn ship', 'group', 'Đế cao 7 phân', '', 2, null, 0),
    qtyRule('rule-fallback-fee', 'Mọi sản phẩm khác — mua 1 sản phẩm: phí ship 30.000đ', 'all', '', '', 1, 1, 30000),
    qtyRule('rule-fallback-free', 'Mọi sản phẩm khác — mua từ 2 sản phẩm: miễn ship', 'all', '', '', 2, null, 0),
  ];

  // Cấu hình SaaS: dùng thử 1 page/1 nhân viên 0đ; cơ bản 5/5; nâng cao
  // 10/10; mua thêm 20.000đ/tháng/page và /nhân viên; tổng đài 0916636785;
  // tên miền chính achat.vn; dùng thử 1 hoặc 7 ngày.
  // Giá gói cơ bản/nâng cao do Super Admin cấu hình sau (chưa có số kiểm
  // chứng nên để 0, không bịa).
  state.saasConfig = {
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
  };

  // Loyalty: 10.000đ = 1 điểm, 1 điểm = 500đ, Bạc từ 1tr -2%, Vàng từ 5tr -5%.
  state.loyaltyConfig = {
    vndPerPoint: 10000,
    pointValueVnd: 500,
    tiers: [
      { name: 'Bạc', minSpent: 1000000, discountPercent: 2 },
      { name: 'Vàng', minSpent: 5000000, discountPercent: 5 },
    ],
  };

  // Điểm lấy hàng in trên nhãn vận chuyển.
  state.shippingConfig = {
    pickupPoint: {
      name: 'Rẻ Mỗi Ngày',
      phone: '0915528008',
      address: 'Thôn Phúc Hưng 1, Xã Liêm Hải, Trực Ninh, Nam Định',
    },
    defaultFee: 30000,
  };

  // Hãng vận chuyển: chỉ tên + trạng thái chưa kết nối. KHÔNG token/khóa
  // thật — kết nối (hợp đồng + chứng thực) do chủ shop làm sau.
  state.carriers = [
    { id: 'ghn', name: 'GHN', apiBaseUrl: '', connected: false },
    { id: 'ghtk', name: 'GHTK', apiBaseUrl: '', connected: false },
    { id: 'vtp', name: 'Viettel Post', apiBaseUrl: '', connected: false },
    { id: 'best', name: 'Best', apiBaseUrl: '', connected: false },
    { id: 'jt', name: 'J&T', apiBaseUrl: '', connected: false },
  ];

  // Meta / CAPI: chưa nối — App ID, redirect URI, Pixel do chủ shop cấu
  // hình sau trong app (không bịa giá trị).
  state.metaConfig = { appId: '', redirectUri: '' };
  state.capiConfigByShop = {
    lua123: { shopKey: 'lua123', pixelId: '', connected: false },
    xinh: { shopKey: 'xinh', pixelId: '', connected: false },
    bedan: { shopKey: 'bedan', pixelId: '', connected: false },
    hana: { shopKey: 'hana', pixelId: '', connected: false },
  };

  // Nhãn hashtag quy trình (dùng chung mọi shop, không chứa dữ liệu kinh doanh).
  state.hashtags = [
    { id: 'tag-cho-xu-ly', label: 'Chờ xử lý' },
    { id: 'tag-da-chot', label: 'Đã chốt' },
    { id: 'tag-da-gui', label: 'Đã gửi' },
    { id: 'tag-hoan-hang', label: 'Hoàn hàng' },
  ];

  return state;
}
