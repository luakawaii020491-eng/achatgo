// types.ts — Định nghĩa toàn bộ kiểu dữ liệu lõi của AChatGo standalone.
// Nguồn số liệu: bản AChatGo v37 (artifact slug achatgo), kiểm chứng qua
// getbootstrap ngày 09-11-2026. Không chứa dữ liệu khách hàng thật.

/** Vai trò tài khoản. */
export type Role = 'super_admin' | 'shop_owner' | 'staff';

/** Gói SaaS: dung-thu (dùng thử), co-ban, nang-cao. */
/** 'pro' = gói cũ trước thời SaaS của 3 shop gốc (5 page / 10 nhân viên), giữ nguyên như trong artifact. */
export type PlanKey = 'dung-thu' | 'co-ban' | 'nang-cao' | 'pro';

/** Trạng thái shop. */
export type ShopStatus = 'active' | 'trial' | 'suspended';

/** Một shop (khách hàng SaaS). */
export interface Shop {
  /** Khóa duy nhất của shop, dùng làm khóa cách ly dữ liệu (vd 'xinh'). */
  key: string;
  /** Tên hiển thị của shop (vd 'DÉP XINH'). */
  name: string;
  /** Tên miền riêng dạng tenshop.achat.vn (vd 'xinh.achat.vn'). */
  domain: string;
  plan: PlanKey;
  /** Giới hạn số fanpage theo gói. */
  pageLimit: number;
  /** Giới hạn số nhân viên theo gói. */
  staffLimit: number;
  /** Ngày hết hạn dùng thử (ISO), chỉ có ở gói dung-thu. */
  trialEndsAt?: string | null;
  status: ShopStatus;
  createdAt: string;
}

/** Một mục chức năng trong ma trận quyền nhân viên. */
export type PermissionModule =
  | 'orders'
  | 'chat'
  | 'products'
  | 'shipping'
  | 'customers'
  | 'finance'
  | 'marketing'
  | 'settings';

/** Một hành động trong ma trận quyền nhân viên. */
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

/** Ma trận quyền nhân viên: module -> các hành động được phép. */
export type StaffPermissions = Partial<Record<PermissionModule, PermissionAction[]>>;

/** Tài khoản đăng nhập (đăng nhập bằng email HOẶC username + mật khẩu). */
export interface Account {
  id: string;
  email: string;
  /** Tên đăng nhập, chuẩn hoá chữ thường, duy nhất. */
  username: string;
  /** Hash bcrypt của mật khẩu. Không bao giờ trả hash này ra ngoài. */
  passwordHash: string;
  role: Role;
  /** Shop sở hữu tài khoản; null với super_admin. */
  shopKey: string | null;
  /** Tên hiển thị (lấy từ nick Facebook với tài khoản shop, không hỏi lại). */
  displayName?: string;
  /** Ma trận quyền, chỉ dùng cho role staff. */
  staffPermissions?: StaffPermissions;
  /** true = bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên. */
  mustChangePassword?: boolean;
  createdAt: string;
}

/** Tài khoản đã tẩy mật khẩu, dùng để trả về cho client. */
export type PublicAccount = Omit<Account, 'passwordHash'>;

/** Một biến thể sản phẩm (màu + size). */
export interface Variant {
  sku: string;
  color: string;
  size: string;
  /** Tồn kho; -1 = không quản lý tồn kho. */
  stock: number;
  /** Giá vốn; 0 = chưa có số thật (không bịa). */
  costPrice: number;
}

/** Sản phẩm trong catalogue của một shop. */
export interface Product {
  id: string;
  /** Shop sở hữu; 'shared' = sản phẩm dùng chung, chỉ Super Admin thấy. */
  shopKey: string;
  name: string;
  /** Nhóm sản phẩm, dùng để khớp quy tắc phí ship scope 'group'. */
  groupName: string;
  /** Giá bán lẻ 1 đôi (đơn vị: đồng). */
  price: number;
  /** Ảnh sản phẩm; chuỗi rỗng khi chưa có ảnh thật (không dùng base64 giả). */
  image: string;
  variants: Variant[];
  createdAt: string;
}

/** Trạng thái đơn hàng — 8 bước (5 bước chính + nhánh hủy). */
export type OrderStatus =
  | 'cho_duyet'
  | 'cho_dong_goi'
  | 'cho_lay_hang'
  | 'dang_giao_hang'
  | 'da_giao_hang'
  | 'huy_giao'
  | 'da_huy'
  | 'hoan_hang';

/** Nhãn tiếng Việt của từng trạng thái đơn. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  cho_duyet: 'Chờ duyệt',
  cho_dong_goi: 'Chờ đóng gói',
  cho_lay_hang: 'Chờ lấy hàng',
  dang_giao_hang: 'Đang giao hàng',
  da_giao_hang: 'Đã giao hàng',
  huy_giao: 'Hủy giao',
  da_huy: 'Đã hủy',
  hoan_hang: 'Hoàn hàng',
};

/** Một dòng hàng trong đơn. */
export interface OrderItem {
  /** Id sản phẩm (để khớp quy tắc phí ship scope 'product'). */
  productId: string;
  sku: string;
  color: string;
  size: string;
  quantity: number;
  /** Đơn giá tại thời điểm chốt (đồng/đôi). */
  price: number;
}

/** Trạng thái gửi sự kiện Purchase về Facebook (Conversions API). */
export type CapiStatus = 'chua_ket_noi' | 'da_gui' | 'loi' | 'chua_gui';

/** Đơn hàng. */
export interface Order {
  /** Mã đơn dạng ACH77000xxx, tăng tuần tự. */
  code: string;
  shopKey: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: OrderItem[];
  /** Tổng tiền hàng (chưa ship, chưa trừ giảm giá). */
  goodsTotal: number;
  /** Phí ship thực tính theo quy tắc của shop. */
  shippingFee: number;
  /** Tổng tiền đơn = tiền hàng + ship - giảm giá. */
  totalAmount: number;
  /** Số COD còn phải thu (mặc định = totalAmount). */
  remainingCod: number;
  /** Tổng giảm giá (coupon + điểm loyalty), đồng. */
  discountAmount: number;
  orderStatus: OrderStatus;
  /** Hãng vận chuyển (vd 'GHN', 'GHTK', 'Viettel Post', 'Best', 'J&T'). */
  carrier: string;
  /** Mã vận đơn hãng trả về. */
  waybillCode: string;
  /**
   * Ghi chú đơn. Khi tạo từ chat, PHẢI bắt đầu bằng "Khách đặt: ..."
   * theo đúng lời khách nói để nhân viên đóng gói đúng món.
   */
  note: string;
  capiStatus: CapiStatus;
  capiLog: string;
  createdAt: string;
  updatedAt: string;
}

/** Khách hàng của một shop. */
export interface Customer {
  id: string;
  shopKey: string;
  name: string;
  phone: string;
  address: string;
  /** Tổng tiền đã mua (đồng), dùng để xếp hạng loyalty. */
  totalSpent: number;
  /** Điểm loyalty tích lũy. */
  loyaltyPoints: number;
  /** Hạng loyalty: 'thuong' | 'bac' | 'vang'. */
  loyaltyTier: string;
  createdAt: string;
}

/** Một tin nhắn trong hội thoại inbox. */
export interface ChatMessage {
  id: string;
  /** 'customer' | 'page' | 'staff' | 'bot'. */
  sender: 'customer' | 'page' | 'staff' | 'bot';
  text: string;
  createdAt: string;
}

/** Hội thoại inbox fanpage. */
export interface Conversation {
  id: string;
  shopKey: string;
  fanpageId: string;
  /** PSID / id khách trên Facebook. */
  customerPsid: string;
  customerName: string;
  messages: ChatMessage[];
  /** true = đã chốt đơn từ hội thoại này. */
  orderClosed: boolean;
  updatedAt: string;
}

/** Fanpage đã kết nối vào một shop. */
export interface Fanpage {
  id: string;
  shopKey: string;
  /** Page id trên Facebook. */
  pageId: string;
  name: string;
  /** Token page kết nối độc lập theo từng shop (lưu ở server, không seed). */
  connected: boolean;
}

/** Phạm vi áp dụng của quy tắc phí ship. */
export type ShipFeeScope = 'group' | 'product' | 'all';

/** Quy tắc phí ship theo shop (v37: mỗi shop có danh sách riêng). */
export interface ShipFeeRule {
  id: string;
  name: string;
  scope: ShipFeeScope;
  /** Tên nhóm SP khi scope='group' (vd 'Quai ngang'). */
  groupName: string | null;
  /** Id sản phẩm khi scope='product'. */
  productId: string | null;
  /** Số lượng tối thiểu áp dụng. */
  minQty: number;
  /** Số lượng tối đa áp dụng; null = không giới hạn. */
  maxQty: number | null;
  /** Phí ship (đồng); 0 = miễn ship. */
  fee: number;
  enabled: boolean;
}

/** Quy tắc AI (trả lời tự động / gợi ý chốt đơn) của một shop. */
export interface AiRule {
  id: string;
  shopKey: string;
  name: string;
  /** Từ khóa kích hoạt (khớp chuỗi con, không phân biệt hoa thường). */
  keywords: string[];
  /** Nội dung trả lời mẫu. */
  reply: string;
  enabled: boolean;
}

/** Cấu hình một hãng vận chuyển. */
export interface CarrierConfig {
  id: string;
  name: string;
  /** Base URL API của hãng; rỗng khi chưa nối. */
  apiBaseUrl: string;
  /** true = đã kết nối thật (có hợp đồng + chứng thực). */
  connected: boolean;
}

/** Mã giảm giá. */
export interface Coupon {
  id: string;
  shopKey: string;
  code: string;
  /** Số tiền giảm (đồng) hoặc % nếu isPercent = true. */
  amount: number;
  isPercent: boolean;
  enabled: boolean;
}

/** Chiến dịch marketing / quảng cáo. */
export interface Campaign {
  id: string;
  shopKey: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
  createdAt: string;
}

/** Một dòng thu/chi trong sổ quỹ. */
export interface CashEntry {
  id: string;
  shopKey: string;
  /** 'thu' | 'chi'. */
  kind: 'thu' | 'chi';
  amount: number;
  note: string;
  createdAt: string;
}

/** Một hạng thành viên loyalty. */
export interface LoyaltyTier {
  name: string;
  /** Tổng tiền mua tối thiểu để đạt hạng (đồng). */
  minSpent: number;
  /** % giảm giá của hạng. */
  discountPercent: number;
}

/** Cấu hình loyalty (đã kiểm chứng v37). */
export interface LoyaltyConfig {
  /** Số tiền mua để tích 1 điểm (đồng). Mặc định 10.000đ = 1 điểm. */
  vndPerPoint: number;
  /** Giá trị quy đổi của 1 điểm (đồng). Mặc định 1 điểm = 500đ. */
  pointValueVnd: number;
  tiers: LoyaltyTier[];
}

/** Một gói SaaS trong cấu hình. */
export interface SaasPlan {
  key: PlanKey;
  name: string;
  pageLimit: number;
  staffLimit: number;
  /** Giá gói (đồng/tháng); 0 = miễn phí. */
  price: number;
}

/** Cấu hình SaaS toàn hệ thống (Super Admin quản trị). */
export interface SaasConfig {
  plans: SaasPlan[];
  /** Giá mua thêm 1 page (đồng/tháng). */
  extraPagePrice: number;
  /** Giá mua thêm 1 nhân viên (đồng/tháng). */
  extraStaffPrice: number;
  /** Tổng đài liên hệ. */
  hotline: string;
  /** Tên miền chính. */
  mainDomain: string;
  /** Các mức dùng thử Super Admin cấu hình được (ngày). */
  trialDaysOptions: number[];
}

/** Điểm lấy hàng in trên nhãn vận chuyển. */
export interface PickupPoint {
  name: string;
  phone: string;
  address: string;
}

/** Cấu hình giao hàng (điểm lấy hàng + phí mặc định dự phòng). */
export interface ShippingConfig {
  pickupPoint: PickupPoint;
  /** Phí ship mặc định khi không khớp quy tắc nào (đồng, cho 1 SP). */
  defaultFee: number;
}

/** Cấu hình kết nối Meta (App ID... — secret không lưu ở đây). */
export interface MetaConfig {
  appId: string;
  /** Redirect URI cố định đã đăng ký trong Meta App. */
  redirectUri: string;
}

/**
 * App TikTok Shop CHUNG của cả nền tảng AChatGo (mô hình Achat — 1 app, mọi
 * shop chỉ bấm "Kết nối TikTok" rồi ủy quyền tài khoản seller, KHÔNG tự
 * đăng ký app riêng). Đăng ký 1 Public app trong TikTok Shop Partner Center
 * (cần giấy tờ doanh nghiệp + chờ TikTok duyệt), nhập 1 lần duy nhất ở
 * Super Admin. appSecret KHÔNG BAO GIỜ trả về client (xem
 * tiktokPlatformPublic trong src/tiktok.ts + stripShopSecrets server.ts).
 */
export interface TikTokPlatformConfig {
  /** App Key của app chung (lấy ở Partner Center → App & Service → app). */
  appKey: string;
  /** App Secret của app chung — chỉ Super Admin nhập, không hiện lại. */
  appSecret: string;
  /** Service ID — dùng để tạo link ủy quyền seller. */
  serviceId: string;
  /** Redirect URL đã đăng ký trong Partner Center (vd https://achat.vn/auth/tiktok/callback). */
  redirectUri: string;
  /** URL webhook đã đăng ký (vd https://achat.vn/webhook/tiktok). */
  webhookUrl: string;
  /** Host authorize: Global mặc định; US dùng services.us.tiktokshop.com. */
  authorizeHost?: string;
  /** Phiên bản API (mặc định 202309). */
  apiVersion?: string;
  updatedAt?: string;
}

/**
 * App Shopee CHUNG của cả nền tảng AChatGo (mô hình Achat — 1 app ISV
 * Third-Party Partner, mọi shop chỉ bấm "Kết nối Shopee" rồi ủy quyền
 * tài khoản seller, KHÔNG tự đăng ký app riêng). Đăng ký 1 app tại
 * open.shopee.com (cần giấy tờ doanh nghiệp + chờ Shopee duyệt ~10 ngày
 * làm việc), nhập 1 lần duy nhất ở Super Admin. partnerKey KHÔNG BAO
 * GIỜ trả về client (xem shopeePlatformPublic trong src/shopee.ts +
 * stripShopSecrets server.ts). partner_key hết hạn sau 180 ngày.
 */
export interface ShopeePlatformConfig {
  /** Partner ID của app chung (lấy ở Shopee Open Platform → console). */
  partnerId: string;
  /** Partner Key của app chung — chỉ Super Admin nhập, không hiện lại. */
  partnerKey: string;
  /** Redirect URL đã đăng ký trong console (vd https://achat.vn/auth/shopee/callback). */
  redirectUri: string;
  /** URL webhook đã đăng ký (vd https://achat.vn/webhook/shopee). */
  webhookUrl: string;
  /** Host API đã cấu hình (mặc định https://partner.shopeemobile.com). */
  apiHost?: string;
  /** true = dùng sandbox (https://partner.test-stable.shopeemobile.com). */
  sandbox?: boolean;
  /** Thời điểm partner_key hiện tại được tạo (ISO) — nhắc reset sau 180 ngày. */
  partnerKeyCreatedAt?: string;
  updatedAt?: string;
}

/** Cấu hình Conversions API (Pixel) của một shop. */
export interface CapiConfig {
  shopKey: string;
  pixelId: string;
  /** true = đã kết nối Pixel, đơn mới tự gửi sự kiện Purchase. */
  connected: boolean;
}

/** Nhãn hashtag quy trình (dùng chung, không chứa dữ liệu kinh doanh). */
export interface Hashtag {
  id: string;
  label: string;
}

/** Câu trả lời nhanh trong khung chat. */
export interface QuickReply {
  id: string;
  shopKey: string;
  title: string;
  text: string;
}

/** Toàn bộ state của hệ thống, lưu trong 1 file JSON. */
export interface State {
  shops: Shop[];
  accounts: Account[];
  products: Product[];
  orders: Order[];
  customers: Customer[];
  conversations: Conversation[];
  fanpages: Fanpage[];
  /** Quy tắc phí ship riêng từng shop: shopKey -> danh sách rule. */
  shipFeeRulesByShop: Record<string, ShipFeeRule[]>;
  /** Quy tắc phí ship fallback toàn cục (Super Admin test). */
  shipFeeRules: ShipFeeRule[];
  aiRules: AiRule[];
  carriers: CarrierConfig[];
  coupons: Coupon[];
  campaigns: Campaign[];
  cashEntries: CashEntry[];
  loyaltyConfig: LoyaltyConfig;
  saasConfig: SaasConfig;
  shippingConfig: ShippingConfig;
  metaConfig: MetaConfig;
  /** App TikTok Shop CHUNG của nền tảng (mô hình Achat — 1 app, xem TikTokPlatformConfig). */
  tiktokPlatform: TikTokPlatformConfig;
  /** App Shopee CHUNG của nền tảng (mô hình Achat — 1 app ISV, xem ShopeePlatformConfig). */
  shopeePlatform: ShopeePlatformConfig;
  /** Cấu hình CAPI theo từng shop: shopKey -> config. */
  capiConfigByShop: Record<string, CapiConfig>;
  hashtags: Hashtag[];
  quickReplies: QuickReply[];
}
