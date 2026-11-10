// pricing.ts — Tính phí ship theo quy tắc của từng shop + tổng tiền đơn.
// Nguồn: bảng COD lên đơn + quy tắc phí ship v37, kiểm chứng 09-11-2026.
// Thứ tự ưu tiên: quy tắc riêng của shop -> fallback toàn cục -> mặc định.
import type { Product, ShipFeeRule, State } from './types.js';

/** Đầu vào tính phí: mỗi dòng cần productId (để khớp rule) + số lượng. */
export interface FeeItem {
  productId: string;
  quantity: number;
}

/** Phí ship mặc định khi không khớp quy tắc nào: 30k cho 1 SP, 0đ từ 2 SP. */
export const DEFAULT_SHIP_FEE_SINGLE = 30000;

/**
 * Bảng COD lên đơn đã kiểm chứng (tổng tiền khách phải trả theo số đôi).
 * Key = nhóm sản phẩm; value = tổng COD theo số đôi (1..3), từ 2 đôi trở
 * lên miễn ship trừ khi ghi chú khác. Số đôi > 3: tính theo giá/đôi.
 */
export const COD_TABLE: Record<string, { pricePerPair: number; totalsByPairs: Record<number, number> }> = {
  // DÉP QUAI NGANG 50k/đôi: 1 đôi 80k, 2 đôi 100k, 3 đôi 150k, miễn ship từ 2.
  'Quai ngang': { pricePerPair: 50000, totalsByPairs: { 1: 80000, 2: 100000, 3: 150000 } },
  // SỤC 3 PHÂN 50k/đôi: 80k / 100k / 150k, miễn ship từ 2.
  'Sục 3 phân': { pricePerPair: 50000, totalsByPairs: { 1: 80000, 2: 100000, 3: 150000 } },
  // DÉP RỌ ĐAN LƯỚI 50k/đôi: 80k / 100k / 150k, miễn ship từ 2.
  'Rọ đan lưới': { pricePerPair: 50000, totalsByPairs: { 1: 80000, 2: 100000, 3: 150000 } },
  // SỤC KHOÉT LỖ 65k/đôi + 25k ship: 1 đôi 90k, 2 đôi 130k miễn ship.
  'Sục khoét lỗ': { pricePerPair: 65000, totalsByPairs: { 1: 90000, 2: 130000, 3: 195000 } },
  // DÉP ĐẾ CAO 7 PHÂN 75k/đôi + 25k ship: 1 đôi 100k, 2 đôi 149k, 3 đôi 224k.
  'Đế cao 7 phân': { pricePerPair: 75000, totalsByPairs: { 1: 100000, 2: 149000, 3: 224000 } },
};

/** Tổng COD theo bảng trên; số đôi > 3 thì tính giá/đôi, miễn ship. */
export function codTotalFor(groupName: string, pairs: number): number {
  const row = COD_TABLE[groupName];
  if (!row) return 0;
  if (row.totalsByPairs[pairs] !== undefined) return row.totalsByPairs[pairs];
  return row.pricePerPair * pairs;
}

function totalQty(items: FeeItem[]): number {
  return items.reduce((sum, it) => sum + Math.max(0, it.quantity), 0);
}

/** Một rule có khớp với giỏ hàng không (phạm vi + số lượng trong [min, max]). */
function ruleMatches(
  rule: ShipFeeRule,
  items: FeeItem[],
  productsById: Map<string, Product>,
): boolean {
  if (!rule.enabled) return false;
  const qty = totalQty(items);
  if (qty < rule.minQty) return false;
  if (rule.maxQty !== null && qty > rule.maxQty) return false;
  if (rule.scope === 'all') return true;
  if (rule.scope === 'product') {
    return rule.productId !== null && items.some((it) => it.productId === rule.productId);
  }
  // scope === 'group': khớp khi có ít nhất 1 dòng thuộc nhóm đó.
  return (
    rule.groupName !== null &&
    items.some((it) => productsById.get(it.productId)?.groupName === rule.groupName)
  );
}

/** Quét danh sách rule theo thứ tự, trả về fee của rule khớp đầu tiên. */
function firstMatchingFee(
  rules: ShipFeeRule[],
  items: FeeItem[],
  productsById: Map<string, Product>,
): number | null {
  for (const rule of rules) {
    if (ruleMatches(rule, items, productsById)) return rule.fee;
  }
  return null;
}

/**
 * Tính phí ship cho một giỏ hàng của shop:
 * 1. Quy tắc riêng của shop (shipFeeRulesByShop[shopKey]), khớp đầu tiên.
 * 2. Fallback toàn cục (shipFeeRules của Super Admin).
 * 3. Mặc định: 1 SP = 30.000đ, từ 2 SP = miễn ship.
 */
export function computeShipFee(state: State, shopKey: string, items: FeeItem[]): number {
  if (items.length === 0) return 0;
  const productsById = new Map(state.products.map((p) => [p.id, p]));
  const shopRules = state.shipFeeRulesByShop[shopKey] ?? [];
  const shopFee = firstMatchingFee(shopRules, items, productsById);
  if (shopFee !== null) return shopFee;
  const globalFee = firstMatchingFee(state.shipFeeRules, items, productsById);
  if (globalFee !== null) return globalFee;
  return totalQty(items) >= 2 ? 0 : DEFAULT_SHIP_FEE_SINGLE;
}

export interface OrderTotalsInput {
  /** Giảm giá coupon (đồng). */
  couponDiscount?: number;
  /** Giảm giá đổi điểm loyalty (đồng). */
  loyaltyDiscount?: number;
}

export interface OrderTotals {
  /** Tổng tiền hàng (chưa ship, chưa trừ giảm giá). */
  goodsTotal: number;
  shippingFee: number;
  /** Tổng tiền đơn = tiền hàng + ship - giảm giá (tối thiểu 0). */
  totalAmount: number;
  /** Số COD còn phải thu (mặc định = totalAmount). */
  remainingCod: number;
}

/**
 * Tính tổng tiền đơn từ các dòng hàng (đã có đơn giá tại thời điểm chốt).
 * discountAmount gộp coupon + loyalty; remainingCod = totalAmount — khi
 * sửa đơn phải patch riêng remainingCod (AChatGo không tự đổi theo).
 */
export function computeOrderTotals(
  state: State,
  shopKey: string,
  items: Array<FeeItem & { price: number }>,
  discounts: OrderTotalsInput = {},
): OrderTotals {
  const goodsTotal = items.reduce(
    (sum, it) => sum + Math.max(0, it.price) * Math.max(0, it.quantity),
    0,
  );
  const shippingFee = computeShipFee(state, shopKey, items);
  const discount = Math.max(0, discounts.couponDiscount ?? 0) + Math.max(0, discounts.loyaltyDiscount ?? 0);
  const totalAmount = Math.max(0, goodsTotal + shippingFee - discount);
  return { goodsTotal, shippingFee, totalAmount, remainingCod: totalAmount };
}
