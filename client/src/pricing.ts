// Tính giá client-side — port chính xác từ src/pricing.ts (server) để màn Tạo đơn
// hiện tổng tiền/phí ship ngay khi nhập, không chờ server.
// Bảng COD lên đơn đã kiểm chứng (tổng tiền khách phải trả theo số đôi).
import type { Product, ShipFeeRule } from './types';

export const COD_TABLE: Record<string, { pricePerPair: number; totalsByPairs: Record<number, number> }> = {
  'Quai ngang': { pricePerPair: 50000, totalsByPairs: { 1: 80000, 2: 100000, 3: 150000 } },
  'Sục 3 phân': { pricePerPair: 50000, totalsByPairs: { 1: 80000, 2: 100000, 3: 150000 } },
  'Rọ đan lưới': { pricePerPair: 50000, totalsByPairs: { 1: 80000, 2: 100000, 3: 150000 } },
  'Sục khoét lỗ': { pricePerPair: 65000, totalsByPairs: { 1: 90000, 2: 130000, 3: 195000 } },
  'Đế cao 7 phân': { pricePerPair: 75000, totalsByPairs: { 1: 100000, 2: 149000, 3: 224000 } },
};

export function codTotalFor(groupName: string, pairs: number): number {
  const row = COD_TABLE[groupName];
  if (!row) return 0;
  if (row.totalsByPairs[pairs] !== undefined) return row.totalsByPairs[pairs];
  return row.pricePerPair * pairs;
}

export interface FeeItem {
  productId: string;
  quantity: number;
}

export const DEFAULT_SHIP_FEE_SINGLE = 30000;

function totalQty(items: FeeItem[]): number {
  return items.reduce((sum, it) => sum + Math.max(0, it.quantity), 0);
}

function ruleMatches(rule: ShipFeeRule, items: FeeItem[], productsById: Map<string, Product>): boolean {
  if (!rule.enabled) return false;
  const qty = totalQty(items);
  if (qty < rule.minQty) return false;
  if (rule.maxQty !== null && qty > rule.maxQty) return false;
  if (rule.scope === 'all') return true;
  if (rule.scope === 'product') {
    return rule.productId !== null && items.some((it) => it.productId === rule.productId);
  }
  return (
    rule.groupName !== null &&
    items.some((it) => productsById.get(it.productId)?.groupName === rule.groupName)
  );
}

function firstMatchingFee(rules: ShipFeeRule[], items: FeeItem[], productsById: Map<string, Product>): number | null {
  for (const rule of rules) {
    if (ruleMatches(rule, items, productsById)) return rule.fee;
  }
  return null;
}

/** Phí ship cho 1 giỏ hàng: rule riêng của shop -> fallback toàn cục -> mặc định. */
export function computeShipFee(
  products: Product[],
  shopRules: ShipFeeRule[],
  globalRules: ShipFeeRule[],
  items: FeeItem[],
): number {
  if (items.length === 0) return 0;
  const productsById = new Map(products.map((p) => [p.id, p]));
  const shopFee = firstMatchingFee(shopRules, items, productsById);
  if (shopFee !== null) return shopFee;
  const globalFee = firstMatchingFee(globalRules, items, productsById);
  if (globalFee !== null) return globalFee;
  return totalQty(items) >= 2 ? 0 : DEFAULT_SHIP_FEE_SINGLE;
}

export interface OrderTotals {
  goodsTotal: number;
  shippingFee: number;
  totalAmount: number;
  remainingCod: number;
}

export function computeOrderTotals(
  products: Product[],
  shopRules: ShipFeeRule[],
  globalRules: ShipFeeRule[],
  items: Array<FeeItem & { price: number }>,
  discount = 0,
): OrderTotals {
  const goodsTotal = items.reduce((sum, it) => sum + Math.max(0, it.price) * Math.max(0, it.quantity), 0);
  const shippingFee = computeShipFee(products, shopRules, globalRules, items);
  const totalAmount = Math.max(0, goodsTotal + shippingFee - Math.max(0, discount));
  return { goodsTotal, shippingFee, totalAmount, remainingCod: totalAmount };
}
