// src/carriers.ts — Hãng vận chuyển: GHN / GHTK / Viettel Post / Best / J&T.
// Gọi API thật theo đúng endpoint đã kiểm chứng (brief v37 09-11-2026).
// Không hard-code token/khóa thật: mọi credential lấy từ CarrierConfig (state/env).
// Mọi lỗi trả { ok:false, error: <tiếng Việt> } kèm mã gốc của hãng (rawCode).
// J&T CHƯA nối thật (đang chờ duyệt developer) -> trả UNSUPPORTED_PUSH rõ ràng,
// KHÔNG bao giờ tạo mã vận đơn giả.

import * as crypto from 'node:crypto';

export type CarrierCode = 'GHN' | 'GHTK' | 'VTP' | 'BEST' | 'JT';

export interface CarrierConfig {
  carrier: CarrierCode;
  /** GHN Token / GHTK Token / VTP session token / Best JWT (lưu ở state, không log). */
  token?: string;
  /** GHN ShopId / GHTK mã shop (vd S...). */
  shopId?: string;
  /** Viettel Post: USERNAME đăng nhập đối tác. */
  username?: string;
  /** Viettel Post: PASSWORD đăng nhập đối tác (chỉ dùng lúc LoginVTP). */
  password?: string;
  /** J&T: apiAccount. */
  apiAccount?: string;
  /** J&T: privateKey (chỉ dùng để ký digest). */
  privateKey?: string;
  /** Best: JWT 30 ngày (lấy từ token). */
  jwt?: string;
  enabled?: boolean;
  /** Địa chỉ lấy hàng mặc định của shop (dùng cho GHTK/VTP pick_* / sender_*). */
  pickupName?: string;
  pickupPhone?: string;
  pickupAddress?: string;
  pickupProvince?: string;
  pickupDistrict?: string;
  pickupWard?: string;
  [key: string]: unknown;
}

export interface ShipOrderInput {
  /** Mã đơn nội bộ (ACH77000xxx). */
  orderCode: string;
  /** Mã gửi hãng (mặc định = orderCode; Best đẩy lại sau hủy dùng -R1/-R2). */
  clientOrderCode?: string;
  toName: string;
  toPhone: string;
  toAddress: string;
  toProvince: string;
  toDistrict: string;
  toWard?: string;
  /** GHN: mã quận/huyện số; GHN bắt buộc. */
  toDistrictId?: number;
  /** GHN: mã phường/xã. */
  toWardCode?: string;
  codAmount: number; // VND, = totalAmount
  weightGrams: number; // 150g/đôi
  items?: Array<{ name: string; quantity: number; price: number }>;
  note?: string;
  /** GHN: service_id (mặc định 2 = giao hàng tiêu chuẩn). */
  serviceId?: number;
  /** Số lần đẩy lại Best sau hủy (0 = lần đầu, 1 -> -R1, 2 -> -R2). */
  bestResendSeq?: number;
}

export interface QuoteRequest {
  toProvince: string;
  toDistrict: string;
  toWard?: string;
  toDistrictId?: number;
  toWardCode?: string;
  weightGrams: number;
  codAmount: number;
  serviceId?: number;
}

export interface CarrierResult {
  ok: boolean;
  fee?: number;
  waybillCode?: string;
  labelUrl?: string;
  printToken?: string;
  trackingUrl?: string;
  status?: string;
  statusText?: string;
  history?: Array<{ time?: string; status?: string; note?: string }>;
  error?: string;
  /** Mã lỗi gốc của hãng (vd GHN code, GHTK message, 'UNSUPPORTED_PUSH', 'NOT_CONNECTED'). */
  rawCode?: string | number;
  raw?: unknown;
  /** Best: sau hủy lỗi 803 thì đẩy lại bằng mã mới -R1/-R2. */
  needsRepush?: boolean;
}

export const GRAMS_PER_PAIR = 150;
export const BEST_CONTRACT_FEE = 12000; // Giá hợp đồng Best: 12.000đ/đơn
export const BEST_SERVICE_CREATE = '12491'; // Mã dịch vụ tạo đơn Best

const GHN_BASE = 'https://online-gateway.ghn.vn';
const GHTK_BASE = 'https://services.giaohangtietkiem.vn';
const VTP_BASE = 'https://partner.viettelpost.vn';
const BEST_BASE = 'http://sgp-seaedi.800best.com/VietNamV3/v3/api/process/sears/';
const JT_BASE = 'https://ylopenplatformapi.jtexpress.vn';

function err(message: string, rawCode?: string | number, raw?: unknown): CarrierResult {
  return { ok: false, error: message, rawCode, raw };
}

function notConnected(carrier: CarrierCode, what: string): CarrierResult {
  return err(
    `Chưa kết nối ${carrier}: ${what}. Vào Cài đặt vận chuyển để nhập thông tin kết nối.`,
    'NOT_CONNECTED',
  );
}

async function httpJson(url: string, init: RequestInit, timeoutMs = 30000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { __status: res.status, __ok: res.ok, body };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- GHN
function ghnHeaders(cfg: CarrierConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Token: cfg.token ?? '',
    ...(cfg.shopId ? { ShopId: cfg.shopId } : {}),
  };
}

async function ghnQuote(cfg: CarrierConfig, req: QuoteRequest): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHN', 'thiếu Token');
  if (!req.toDistrictId) return err('Thiếu mã quận/huyện GHN (toDistrictId) nên không tính được phí.', 'MISSING_DISTRICT');
  const r = await httpJson(`${GHN_BASE}/shipping-order/fee`, {
    method: 'POST',
    headers: ghnHeaders(cfg),
    body: JSON.stringify({
      service_id: req.serviceId ?? 2,
      to_district_id: req.toDistrictId,
      to_ward_code: req.toWardCode,
      weight: req.weightGrams,
      insurance_value: req.codAmount,
      cod_value: req.codAmount,
      length: 20,
      width: 15,
      height: 10,
    }),
  });
  const b = r.body;
  if (!r.__ok || b?.code !== 200) {
    return err(`GHN báo lỗi tính phí: ${b?.message ?? b?.data ?? 'lỗi không rõ'}.`, b?.code ?? r.__status, b);
  }
  return { ok: true, fee: b.data?.total ?? b.data?.service_fee };
}

async function ghnPush(cfg: CarrierConfig, o: ShipOrderInput): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHN', 'thiếu Token');
  if (!o.toDistrictId) return err('Thiếu mã quận/huyện GHN (toDistrictId) nên không tạo được đơn.', 'MISSING_DISTRICT');
  const content = (o.items ?? []).map((i) => `${i.quantity}x ${i.name}`).join(', ') || 'Dép';
  const r = await httpJson(`${GHN_BASE}/shipping-order/create`, {
    method: 'POST',
    headers: ghnHeaders(cfg),
    body: JSON.stringify({
      to_name: o.toName,
      to_phone: o.toPhone,
      to_address: o.toAddress,
      to_ward_code: o.toWardCode,
      to_district_id: o.toDistrictId,
      cod_amount: o.codAmount,
      content,
      weight: o.weightGrams,
      length: 20,
      width: 15,
      height: 10,
      service_id: o.serviceId ?? 2,
      payment_type_id: 1, // 1 = người gửi trả phí
      required_note: 'CHOXEMHANGKHONGTHU', // Cho xem hàng, không thử (đúng chính sách shop)
      client_order_code: o.clientOrderCode ?? o.orderCode,
      note: o.note,
    }),
  });
  const b = r.body;
  if (!r.__ok || b?.code !== 200) {
    return err(`GHN báo lỗi tạo đơn: ${b?.message ?? b?.data ?? 'lỗi không rõ'}.`, b?.code ?? r.__status, b);
  }
  return {
    ok: true,
    waybillCode: b.data?.order_code,
    fee: b.data?.total_fee,
    trackingUrl: `https://tracking.ghn.vn/?order_code=${b.data?.order_code}`,
    raw: b.data,
  };
}

async function ghnCancel(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHN', 'thiếu Token');
  const r = await httpJson(`${GHN_BASE}/switch-status/cancel`, {
    method: 'POST',
    headers: ghnHeaders(cfg),
    body: JSON.stringify({ order_codes: [waybillCode] }),
  });
  const b = r.body;
  if (!r.__ok || b?.code !== 200) {
    return err(`GHN báo lỗi hủy đơn: ${b?.message ?? 'lỗi không rõ'}.`, b?.code ?? r.__status, b);
  }
  return { ok: true, waybillCode, raw: b.data };
}

async function ghnTrack(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHN', 'thiếu Token');
  const r = await httpJson(`${GHN_BASE}/shipping-order/detail`, {
    method: 'POST',
    headers: ghnHeaders(cfg),
    body: JSON.stringify({ order_code: waybillCode }),
  });
  const b = r.body;
  if (!r.__ok || b?.code !== 200) {
    return err(`GHN báo lỗi tra cứu: ${b?.message ?? 'lỗi không rõ'}.`, b?.code ?? r.__status, b);
  }
  const d = b.data ?? {};
  return {
    ok: true,
    waybillCode,
    status: d.status,
    statusText: d.status,
    fee: d.total_fee,
    history: Array.isArray(d.log) ? d.log.map((l: any) => ({ time: l.updated_date, status: l.status, note: l.note })) : [],
    raw: d,
  };
}

// ---------------------------------------------------------------- GHTK
function ghtkHeaders(cfg: CarrierConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Token: cfg.token ?? '',
    'X-Client-Source': cfg.shopId ?? '',
  };
}

async function ghtkQuote(cfg: CarrierConfig, req: QuoteRequest): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHTK', 'thiếu Token');
  const q = new URLSearchParams({
    pick_province: cfg.pickupProvince ?? '',
    pick_district: cfg.pickupDistrict ?? '',
    province: req.toProvince,
    district: req.toDistrict,
    address: req.toWard ?? '',
    weight: String(req.weightGrams),
    value: String(req.codAmount),
    transport: 'road',
    deliver_option: 'none',
  });
  const r = await httpJson(`${GHTK_BASE}/services/shipment/fee?${q.toString()}`, {
    method: 'GET',
    headers: ghtkHeaders(cfg),
  });
  const b = r.body;
  if (!b?.success) {
    return err(`GHTK báo lỗi tính phí: ${b?.message ?? 'lỗi không rõ'}.`, b?.message ?? r.__status, b);
  }
  return { ok: true, fee: b.fee?.fee ?? b.fee?.total };
}

async function ghtkPush(cfg: CarrierConfig, o: ShipOrderInput): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHTK', 'thiếu Token');
  const products = (o.items ?? []).map((i) => ({ name: i.name, weight: o.weightGrams / Math.max(1, i.quantity), quantity: i.quantity, product_code: '' }));
  const r = await httpJson(`${GHTK_BASE}/services/shipment/order`, {
    method: 'POST',
    headers: ghtkHeaders(cfg),
    body: JSON.stringify({
      id: o.clientOrderCode ?? o.orderCode,
      pick_name: cfg.pickupName ?? '',
      pick_address: cfg.pickupAddress ?? '',
      pick_province: cfg.pickupProvince ?? '',
      pick_district: cfg.pickupDistrict ?? '',
      pick_tel: cfg.pickupPhone ?? '',
      name: o.toName,
      address: o.toAddress,
      province: o.toProvince,
      district: o.toDistrict,
      ward: o.toWard ?? '',
      tel: o.toPhone,
      note: o.note ?? '',
      weight: o.weightGrams,
      value: o.codAmount,
      transport: 'road',
      pick_option: 'cod',
      pick_money: o.codAmount,
      products,
    }),
  });
  const b = r.body;
  if (!b?.success) {
    return err(`GHTK báo lỗi tạo đơn: ${b?.message ?? 'lỗi không rõ'}.`, b?.message ?? r.__status, b);
  }
  const label = b.order?.label;
  return {
    ok: true,
    waybillCode: label,
    fee: b.order?.fee,
    labelUrl: label ? `${GHTK_BASE}/services/label/${label}` : undefined,
    raw: b.order,
  };
}

async function ghtkCancel(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHTK', 'thiếu Token');
  const r = await httpJson(`${GHTK_BASE}/services/shipment/cancel/${encodeURIComponent(waybillCode)}`, {
    method: 'POST',
    headers: ghtkHeaders(cfg),
  });
  const b = r.body;
  if (!b?.success) {
    return err(`GHTK báo lỗi hủy đơn: ${b?.message ?? 'lỗi không rõ'}.`, b?.message ?? r.__status, b);
  }
  return { ok: true, waybillCode, raw: b };
}

async function ghtkTrack(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  if (!cfg.token) return notConnected('GHTK', 'thiếu Token');
  const r = await httpJson(`${GHTK_BASE}/services/shipment/v2/${encodeURIComponent(waybillCode)}`, {
    method: 'GET',
    headers: ghtkHeaders(cfg),
  });
  const b = r.body;
  if (!b?.success) {
    return err(`GHTK báo lỗi tra cứu: ${b?.message ?? 'lỗi không rõ'}.`, b?.message ?? r.__status, b);
  }
  const order = b.order ?? {};
  return {
    ok: true,
    waybillCode,
    status: order.status_text ?? String(order.status ?? ''),
    statusText: order.status_text,
    fee: order.fee,
    raw: order,
  };
}

// ---------------------------------------------------------------- Viettel Post
// Endpoint theo tài liệu đối tác VTP: LoginVTP đổi USERNAME/PASSWORD lấy token phiên,
// hủy đơn POST /v2/order/UpdateOrder với TYPE=4. Các endpoint giá/tạo/tra cứu dùng
// dạng chuẩn /v2/order/* của cùng tài liệu.
export async function vtpLogin(cfg: CarrierConfig): Promise<CarrierResult & { sessionToken?: string }> {
  if (!cfg.username || !cfg.password) return notConnected('VTP', 'thiếu USERNAME/PASSWORD Viettel Post');
  const r = await httpJson(`${VTP_BASE}/v2/user/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ USERNAME: cfg.username, PASSWORD: cfg.password }),
  });
  const b = r.body;
  const token = b?.data?.token;
  if (!r.__ok || !token) {
    return err(`Viettel Post đăng nhập thất bại: ${b?.message ?? b?.error ?? 'lỗi không rõ'}.`, b?.error ?? r.__status, b);
  }
  return { ok: true, sessionToken: token, raw: b.data };
}

function vtpHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Token: token };
}

async function vtpQuote(cfg: CarrierConfig, req: QuoteRequest): Promise<CarrierResult> {
  const token = cfg.token ?? (await vtpLogin(cfg)).sessionToken;
  if (!token) return notConnected('VTP', 'không đăng nhập được (thiếu USERNAME/PASSWORD hoặc sai thông tin)');
  const r = await httpJson(`${VTP_BASE}/v2/order/getPrice`, {
    method: 'POST',
    headers: vtpHeaders(token),
    body: JSON.stringify({
      SENDER_PROVINCE: cfg.pickupProvince ?? '',
      SENDER_DISTRICT: cfg.pickupDistrict ?? '',
      RECEIVER_PROVINCE: req.toProvince,
      RECEIVER_DISTRICT: req.toDistrict,
      PRODUCT_TYPE: 'HH',
      PRODUCT_WEIGHT: req.weightGrams,
      PRODUCT_PRICE: req.codAmount,
      MONEY_COLLECTION: String(req.codAmount),
      TYPE: 1,
    }),
  });
  const b = r.body;
  const fee = b?.data?.MONEY_TOTAL ?? b?.data?.TOTAL_FEE;
  if (!r.__ok || fee === undefined) {
    return err(`Viettel Post báo lỗi tính phí: ${b?.message ?? b?.error ?? 'lỗi không rõ'}.`, b?.error ?? r.__status, b);
  }
  return { ok: true, fee };
}

async function vtpPush(cfg: CarrierConfig, o: ShipOrderInput): Promise<CarrierResult> {
  const token = cfg.token ?? (await vtpLogin(cfg)).sessionToken;
  if (!token) return notConnected('VTP', 'không đăng nhập được (thiếu USERNAME/PASSWORD hoặc sai thông tin)');
  const productName = (o.items ?? []).map((i) => `${i.quantity}x ${i.name}`).join(', ') || 'Dép';
  const r = await httpJson(`${VTP_BASE}/v2/order/createOrder`, {
    method: 'POST',
    headers: vtpHeaders(token),
    body: JSON.stringify({
      ORDER_NUMBER: o.clientOrderCode ?? o.orderCode,
      SENDER_FULLNAME: cfg.pickupName ?? '',
      SENDER_ADDRESS: cfg.pickupAddress ?? '',
      SENDER_PHONE: cfg.pickupPhone ?? '',
      SENDER_WARD: cfg.pickupWard ?? '',
      SENDER_DISTRICT: cfg.pickupDistrict ?? '',
      SENDER_PROVINCE: cfg.pickupProvince ?? '',
      RECEIVER_FULLNAME: o.toName,
      RECEIVER_ADDRESS: o.toAddress,
      RECEIVER_PHONE: o.toPhone,
      RECEIVER_WARD: o.toWard ?? '',
      RECEIVER_DISTRICT: o.toDistrict,
      RECEIVER_PROVINCE: o.toProvince,
      PRODUCT_NAME: productName,
      PRODUCT_QUANTITY: (o.items ?? []).reduce((s, i) => s + i.quantity, 0) || 1,
      PRODUCT_PRICE: o.codAmount,
      PRODUCT_WEIGHT: o.weightGrams,
      ORDER_PAYMENT: 3, // 3 = người nhận trả COD
      ORDER_SERVICE: 'LCOD',
      MONEY_COLLECTION: String(o.codAmount),
      MONEY_TOTALFEE: 0,
      ORDER_NOTE: o.note ?? '',
    }),
  });
  const b = r.body;
  const waybill = b?.data?.ORDER_NUMBER;
  if (!r.__ok || !waybill) {
    return err(`Viettel Post báo lỗi tạo đơn: ${b?.message ?? b?.error ?? 'lỗi không rõ'}.`, b?.error ?? r.__status, b);
  }
  return { ok: true, waybillCode: waybill, fee: b.data?.MONEY_TOTALFEE, raw: b.data };
}

async function vtpCancel(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  const token = cfg.token ?? (await vtpLogin(cfg)).sessionToken;
  if (!token) return notConnected('VTP', 'không đăng nhập được (thiếu USERNAME/PASSWORD hoặc sai thông tin)');
  const r = await httpJson(`${VTP_BASE}/v2/order/UpdateOrder`, {
    method: 'POST',
    headers: vtpHeaders(token),
    body: JSON.stringify({ TYPE: 4, ORDER_NUMBER: waybillCode }),
  });
  const b = r.body;
  if (!r.__ok || b?.status === 200 && b?.data === false) {
    return err(`Viettel Post báo lỗi hủy đơn: ${b?.message ?? b?.error ?? 'lỗi không rõ'}.`, b?.error ?? r.__status, b);
  }
  return { ok: true, waybillCode, raw: b };
}

async function vtpTrack(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  const token = cfg.token ?? (await vtpLogin(cfg)).sessionToken;
  if (!token) return notConnected('VTP', 'không đăng nhập được (thiếu USERNAME/PASSWORD hoặc sai thông tin)');
  const r = await httpJson(`${VTP_BASE}/v2/order/getOrderInfo`, {
    method: 'POST',
    headers: vtpHeaders(token),
    body: JSON.stringify({ ORDER_NUMBER: waybillCode }),
  });
  const b = r.body;
  const d = b?.data;
  if (!r.__ok || !d) {
    return err(`Viettel Post báo lỗi tra cứu: ${b?.message ?? b?.error ?? 'lỗi không rõ'}.`, b?.error ?? r.__status, b);
  }
  return {
    ok: true,
    waybillCode,
    status: d.ORDER_STATUS ?? d.STATUS,
    statusText: d.ORDER_STATUSNAME ?? d.STATUS,
    fee: d.MONEY_TOTALFEE,
    raw: d,
  };
}

// ---------------------------------------------------------------- Best
// Best EDI v3: 1 endpoint process/sears, xác thực JWT Bearer (hiệu lực 30 ngày).
// Tạo đơn dùng mã dịch vụ 12491. Phí lấy theo giá hợp đồng 12.000đ/đơn (không gọi API).
function bestHeaders(cfg: CarrierConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.jwt ?? cfg.token ?? ''}`,
  };
}

async function bestCall(cfg: CarrierConfig, service: string, bizContent: Record<string, unknown>): Promise<any> {
  if (!cfg.jwt && !cfg.token) return { __error: notConnected('BEST', 'thiếu JWT') };
  const r = await httpJson(BEST_BASE, {
    method: 'POST',
    headers: bestHeaders(cfg),
    body: JSON.stringify({ service, bizContent }),
  });
  return r.body;
}

async function bestPush(cfg: CarrierConfig, o: ShipOrderInput): Promise<CarrierResult> {
  // Mã gửi hãng: lần đầu = mã đơn; sau hủy lỗi 803 thì tạo lại bằng mã mới -R1/-R2.
  const seq = o.bestResendSeq ?? 0;
  const merchantCode = seq > 0 ? `${o.orderCode}-R${seq}` : (o.clientOrderCode ?? o.orderCode);
  const body = await bestCall(cfg, BEST_SERVICE_CREATE, {
    merchantCode,
    receiverName: o.toName,
    receiverPhone: o.toPhone,
    receiverAddress: `${o.toAddress}, ${o.toWard ? o.toWard + ', ' : ''}${o.toDistrict}, ${o.toProvince}`,
    codAmount: o.codAmount,
    weight: o.weightGrams,
    itemName: (o.items ?? []).map((i) => `${i.quantity}x ${i.name}`).join(', ') || 'Dép',
    remark: o.note ?? '',
  });
  if (body?.__error) return body.__error as CarrierResult;
  // Best trả code '803' khi mã gửi hãng đã tồn tại sau hủy -> caller đẩy lại với -R1/-R2.
  const code = body?.code ?? body?.resultCode;
  if (code !== undefined && String(code) !== '200' && String(code) !== '0' && body?.success !== true) {
    const needsRepush = String(code) === '803';
    return {
      ...err(`Best báo lỗi tạo đơn: ${body?.message ?? body?.msg ?? 'lỗi không rõ'}.`, code, body),
      ...(needsRepush ? { needsRepush: true } : {}),
    };
  }
  const waybill = body?.data?.waybillCode ?? body?.data?.mailNo ?? body?.data?.orderCode;
  if (!waybill) {
    return err('Best không trả mã vận đơn (phản hồi không có waybillCode).', code, body);
  }
  return { ok: true, waybillCode: String(waybill), fee: BEST_CONTRACT_FEE, raw: body?.data ?? body };
}

/** Webhook Best: chuẩn hoá payload hãng đẩy về (trạng thái vận đơn). */
export function bestWebhookReceive(payload: any): CarrierResult & {
  event?: string;
  orderCode?: string;
  merchantCode?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Webhook Best: payload rỗng hoặc sai định dạng.', rawCode: 'BAD_PAYLOAD' };
  }
  const data = payload.bizContent ?? payload.data ?? payload;
  const merchantCode = data.merchantCode ?? data.orderCode ?? data.clientOrderCode;
  const waybillCode = data.waybillCode ?? data.mailNo;
  const status = data.status ?? data.orderStatus ?? payload.service;
  if (!merchantCode && !waybillCode) {
    return { ok: false, error: 'Webhook Best: thiếu mã đơn (merchantCode/waybillCode).', rawCode: 'BAD_PAYLOAD', raw: payload };
  }
  return {
    ok: true,
    event: payload.service ?? 'best_webhook',
    orderCode: merchantCode ? String(merchantCode).replace(/-R\d+$/, '') : undefined,
    merchantCode: merchantCode ? String(merchantCode) : undefined,
    waybillCode: waybillCode ? String(waybillCode) : undefined,
    status: status ? String(status) : undefined,
    statusText: data.statusDesc ?? data.message,
    raw: payload,
  };
}

// ---------------------------------------------------------------- J&T
// J&T: ký digest = base64(md5(bizContent + privateKey)), timestamp ms.
// CHƯA nối thật vì đang chờ duyệt developer -> mọi thao tác đẩy/tính phí/tra cứu
// trả UNSUPPORTED_PUSH rõ ràng, KHÔNG tạo mã giả.
export function jtDigest(bizContent: string, privateKey: string): string {
  const md5hex = crypto.createHash('md5').update(bizContent + privateKey, 'utf8').digest('hex');
  return Buffer.from(md5hex, 'utf8').toString('base64');
}

export function jtTimestampMs(): number {
  return Date.now(); // epoch ms (mốc UTC); nhãn UTC+7 chỉ để đối chiếu giờ hiển thị
}

function jtUnsupported(op: string): CarrierResult {
  return err(
    `J&T chưa được kết nối thật (đang chờ J&T duyệt chứng nhận developer) nên không ${op} được. Không tạo mã vận đơn giả — đơn giữ trạng thái chờ đẩy. Mã lỗi: UNSUPPORTED_PUSH.`,
    'UNSUPPORTED_PUSH',
  );
}

// ---------------------------------------------------------------- Dispatcher
export async function quoteCarrierFee(cfg: CarrierConfig, req: QuoteRequest): Promise<CarrierResult> {
  if (cfg.enabled === false) return err(`Hãng ${cfg.carrier} đang tắt trong cài đặt.`, 'DISABLED');
  try {
    switch (cfg.carrier) {
      case 'GHN': return ghnQuote(cfg, req);
      case 'GHTK': return ghtkQuote(cfg, req);
      case 'VTP': return vtpQuote(cfg, req);
      case 'BEST': return { ok: true, fee: BEST_CONTRACT_FEE }; // Giá hợp đồng 12.000đ/đơn
      case 'JT': return jtUnsupported('tính phí');
    }
  } catch (e: any) {
    return err(`Lỗi khi tính phí ${cfg.carrier}: ${e?.message ?? String(e)}`, 'EXCEPTION');
  }
}

export async function pushOrderToCarrier(cfg: CarrierConfig, order: ShipOrderInput): Promise<CarrierResult> {
  // J&T chưa nối thật (chờ duyệt developer): trả UNSUPPORTED_PUSH ngay cả
  // khi chưa có cấu hình — không để rơi xuống lỗi "chưa kết nối" hay kiểm
  // tra địa chỉ trước, và tuyệt đối không tạo mã vận đơn giả.
  if (cfg.carrier === 'JT') return jtUnsupported('đẩy đơn');
  if (cfg.enabled === false) return err(`Hãng ${cfg.carrier} đang tắt trong cài đặt.`, 'DISABLED');
  if (!order.toPhone || !order.toAddress || !order.toProvince || !order.toDistrict) {
    return err('Thiếu địa chỉ giao hàng (tên/SĐT/địa chỉ/tỉnh/huyện) nên không đẩy được đơn.', 'MISSING_ADDRESS');
  }
  try {
    switch (cfg.carrier) {
      case 'GHN': return ghnPush(cfg, order);
      case 'GHTK': return ghtkPush(cfg, order);
      case 'VTP': return vtpPush(cfg, order);
      case 'BEST': return bestPush(cfg, order);
      // 'JT' đã trả UNSUPPORTED_PUSH ở đầu hàm, không tới được đây.
    }
  } catch (e: any) {
    return err(`Lỗi khi đẩy đơn qua ${cfg.carrier}: ${e?.message ?? String(e)}`, 'EXCEPTION');
  }
}

export async function cancelWaybill(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  if (!waybillCode) return err('Thiếu mã vận đơn để hủy.', 'MISSING_WAYBILL');
  try {
    switch (cfg.carrier) {
      case 'GHN': return ghnCancel(cfg, waybillCode);
      case 'GHTK': return ghtkCancel(cfg, waybillCode);
      case 'VTP': return vtpCancel(cfg, waybillCode);
      case 'BEST':
        // Best không có thao tác hủy trực tiếp trong bản này: hủy tay trên hệ thống
        // Best rồi đẩy lại bằng mã gửi hãng mới -R1/-R2 (flow lỗi 803).
        return {
          ...err('Best không hỗ trợ hủy trực tiếp qua API trong bản này. Hủy tay trên hệ thống Best rồi đẩy lại bằng mã gửi hãng mới (-R1/-R2).', 'UNSUPPORTED_CANCEL'),
          needsRepush: true,
        };
      case 'JT': return jtUnsupported('hủy đơn');
    }
  } catch (e: any) {
    return err(`Lỗi khi hủy vận đơn ${cfg.carrier}: ${e?.message ?? String(e)}`, 'EXCEPTION');
  }
}

export async function trackWaybill(cfg: CarrierConfig, waybillCode: string): Promise<CarrierResult> {
  if (!waybillCode) return err('Thiếu mã vận đơn để tra cứu.', 'MISSING_WAYBILL');
  try {
    switch (cfg.carrier) {
      case 'GHN': return ghnTrack(cfg, waybillCode);
      case 'GHTK': return ghtkTrack(cfg, waybillCode);
      case 'VTP': return vtpTrack(cfg, waybillCode);
      case 'BEST': {
        if (!cfg.jwt && !cfg.token) return notConnected('BEST', 'thiếu JWT');
        // Best tra cứu qua cùng endpoint process/sears (dịch vụ tra cứu theo tài liệu Best).
        const body = await bestCall(cfg, 'query', { waybillCode });
        if (body?.__error) return body.__error as CarrierResult;
        return { ok: true, waybillCode, status: body?.data?.status, statusText: body?.data?.statusDesc, raw: body };
      }
      case 'JT': return jtUnsupported('tra cứu');
    }
  } catch (e: any) {
    return err(`Lỗi khi tra cứu vận đơn ${cfg.carrier}: ${e?.message ?? String(e)}`, 'EXCEPTION');
  }
}

/** Kiểm tra kết nối hãng: GHN/GHTK/VTP gọi thử tính phí tối thiểu; Best kiểm tra JWT; J&T báo chưa nối. */
export async function testCarrierConnection(cfg: CarrierConfig): Promise<CarrierResult> {
  try {
    switch (cfg.carrier) {
      case 'GHN': {
        if (!cfg.token) return notConnected('GHN', 'thiếu Token');
        // GHN không có endpoint ping: gọi tính phí với địa chỉ mẫu, lỗi "thiếu dữ liệu"
        // vẫn chứng tỏ token hợp lệ (token sai sẽ trả 401/message token không hợp lệ).
        const r = await httpJson(`${GHN_BASE}/shipping-order/fee`, {
          method: 'POST',
          headers: ghnHeaders(cfg),
          body: JSON.stringify({ service_id: 2, to_district_id: 1442, weight: 150, insurance_value: 0, cod_value: 0 }),
        });
        const b = r.body;
        if (r.__status === 401 || (typeof b?.message === 'string' && /token/i.test(b.message))) {
          return err(`GHN: Token không hợp lệ (${b?.message ?? 'HTTP 401'}).`, b?.code ?? 401, b);
        }
        return { ok: true, statusText: 'Kết nối GHN OK (token hợp lệ).', raw: b };
      }
      case 'GHTK': {
        if (!cfg.token) return notConnected('GHTK', 'thiếu Token');
        const r = await httpJson(`${GHTK_BASE}/services/shipment/fee?pick_province=Hà Nội&pick_district=Quận Hai Bà Trưng&province=Hà Nội&district=Quận Hai Bà Trưng&weight=150&value=0&transport=road`, {
          method: 'GET',
          headers: ghtkHeaders(cfg),
        });
        const b = r.body;
        if (!b?.success) return err(`GHTK: kết nối thất bại — ${b?.message ?? 'token không hợp lệ'}.`, b?.message, b);
        return { ok: true, statusText: 'Kết nối GHTK OK.', fee: b.fee?.fee };
      }
      case 'VTP': {
        const login = await vtpLogin(cfg);
        if (!login.ok) return login;
        return { ok: true, statusText: 'Kết nối Viettel Post OK (đăng nhập LoginVTP thành công).' };
      }
      case 'BEST': {
        const jwt = cfg.jwt ?? cfg.token;
        if (!jwt) return notConnected('BEST', 'thiếu JWT');
        // JWT hết hạn sau 30 ngày: giải mã phần payload để kiểm tra exp (không gọi API).
        try {
          const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64').toString('utf8'));
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            return err('Best: JWT đã hết hạn (hiệu lực 30 ngày). Lấy JWT mới rồi nhập lại.', 'JWT_EXPIRED');
          }
        } catch {
          // JWT không đúng dạng JWT chuẩn -> để lần gọi API đầu tiên báo lỗi thật.
        }
        return { ok: true, statusText: 'Kết nối Best OK (JWT còn hiệu lực, giá hợp đồng 12.000đ/đơn).', fee: BEST_CONTRACT_FEE };
      }
      case 'JT':
        return jtUnsupported('kiểm tra kết nối');
    }
  } catch (e: any) {
    return err(`Lỗi khi kiểm tra kết nối ${cfg.carrier}: ${e?.message ?? String(e)}`, 'EXCEPTION');
  }
}
