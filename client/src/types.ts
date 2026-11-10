// Kiểu dữ liệu client — mirror lỏng của src/types.ts + các collection mở rộng
// mà action getbootstrap trả về (comments, liveSessions, returnSlips, ...).
// Dùng `any` ở các collection mở rộng để không vỡ khi server thêm trường.

export interface Account {
  id: string;
  email: string;
  username: string;
  role: 'super_admin' | 'shop_owner' | 'staff';
  shopKey: string | null;
  displayName?: string;
  staffPermissions?: Record<string, string[]>;
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface Shop {
  key: string;
  name: string;
  domain: string;
  plan: string;
  pageLimit: number;
  staffLimit: number;
  trialEndsAt?: string | null;
  status: string;
  createdAt: string;
}

export interface Variant {
  sku: string;
  color: string;
  size: string;
  stock: number;
  costPrice: number;
}

export interface Product {
  id: string;
  shopKey: string;
  name: string;
  groupName: string;
  price: number;
  image: string;
  variants: Variant[];
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  sku: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
}

export type OrderStatus =
  | 'cho_duyet'
  | 'cho_dong_goi'
  | 'cho_lay_hang'
  | 'dang_giao_hang'
  | 'da_giao_hang'
  | 'huy_giao'
  | 'da_huy'
  | 'hoan_hang';

export const ORDER_STATUS_LABELS: Record<string, string> = {
  cho_duyet: 'Chờ duyệt',
  cho_dong_goi: 'Chờ đóng gói',
  cho_lay_hang: 'Chờ lấy hàng',
  dang_giao_hang: 'Đang giao hàng',
  da_giao_hang: 'Đã giao hàng',
  huy_giao: 'Hủy giao',
  da_huy: 'Đã hủy',
  hoan_hang: 'Hoàn hàng',
};

export interface Order {
  id: string;
  code: string;
  shopKey: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: OrderItem[];
  goodsTotal: number;
  shippingFee: number;
  totalAmount: number;
  remainingCod: number;
  discountAmount: number;
  orderStatus: OrderStatus;
  carrier: string;
  waybillCode: string;
  note: string;
  capiStatus: string;
  capiLog: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: any;
}

export interface Customer {
  id: string;
  shopKey: string;
  name: string;
  phone: string;
  address: string;
  totalSpent: number;
  loyaltyPoints: number;
  loyaltyTier: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  sender: 'customer' | 'page' | 'staff' | 'bot';
  text: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  shopKey: string;
  fanpageId: string;
  customerPsid: string;
  customerName: string;
  messages: ChatMessage[];
  orderClosed: boolean;
  updatedAt: string;
  [k: string]: any;
}

export interface Fanpage {
  id: string;
  shopKey: string;
  pageId: string;
  name: string;
  connected: boolean;
  [k: string]: any;
}

export interface ShipFeeRule {
  id: string;
  name: string;
  scope: 'group' | 'product' | 'all';
  groupName: string | null;
  productId: string | null;
  minQty: number;
  maxQty: number | null;
  fee: number;
  enabled: boolean;
}

export interface BootstrapData {
  shops: Shop[];
  accounts: Account[];
  orders: Order[];
  products: Product[];
  customers: Customer[];
  conversations: Conversation[];
  fanpages: Fanpage[];
  shipFeeRulesByShop: Record<string, ShipFeeRule[]>;
  shipFeeRules: ShipFeeRule[];
  aiRules: any[];
  carriers: any[];
  coupons: any[];
  campaigns: any[];
  cashEntries: any[];
  loyaltyConfig: any;
  saasConfig: any;
  shippingConfig: any;
  metaConfig: any;
  capiConfigByShop: Record<string, any>;
  hashtags: any[];
  quickReplies: any[];
  comments: any[];
  liveSessions: any[];
  aiDrafts: any[];
  trainChats: any[];
  supplierDebts: any[];
  stockRecords: any[];
  returnSlips: any[];
  commentScripts: any[];
  tiktokSkuMaps: any[];
  tiktokFinance: any[];
  tiktokReturns: any[];
  tiktokWebhookEvents: any[];
  tiktokMessages: any[];
  shopeeSkuMaps: any[];
  shopeeFinance: any[];
  shopeeReturns: any[];
  shopeeWebhookEvents: any[];
  records?: Record<string, any[]>;
  dataIsolationApplied?: boolean;
  superAdminSetup?: boolean;
  _meta?: { shopKey: string | null; isSuperAdmin: boolean; version: string };
}
