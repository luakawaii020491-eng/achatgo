// auth.ts — Hash mật khẩu, đăng nhập, che secret, sinh mã đơn.
// Lưu ý quan trọng: hash mật khẩu trong artifact Muse KHÔNG xuất được,
// nên tài khoản cũ phải ĐẶT LẠI mật khẩu khi lên Render (băm lại bằng
// bcryptjs tại đây). Mật khẩu mới luôn băm bằng bcrypt.
import bcrypt from 'bcryptjs';
import type { Account, PublicAccount, State } from './types.js';

/** Số vòng salt của bcrypt (mặc định 10 — đủ an toàn, đủ nhanh). */
const SALT_ROUNDS = 10;

/** Băm mật khẩu mới bằng bcrypt. */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

/**
 * Kiểm tra mật khẩu với hash đã lưu. Dùng bcrypt.compareSync (so sánh an
 * toàn theo thời gian hằng số trên hash) — không bao giờ so chuỗi trực tiếp.
 */
export function verifyPassword(password: string, passwordHash: string): boolean {
  if (!password || !passwordHash) return false;
  try {
    return bcrypt.compareSync(password, passwordHash);
  } catch {
    return false;
  }
}

/** Tẩy mật khẩu khỏi tài khoản trước khi trả về cho client. */
export function toPublicAccount(account: Account): PublicAccount {
  const { passwordHash: _passwordHash, ...rest } = account;
  return rest;
}

export type LoginResult =
  | { ok: true; account: PublicAccount }
  | { ok: false; error: string };

/**
 * Đăng nhập bằng email HOẶC username + mật khẩu.
 * - So khớp email/username không phân biệt hoa thường, đã trim.
 * - Sai tài khoản hay sai mật khẩu đều trả cùng một lỗi chung (không để lộ
 *   tài khoản có tồn tại hay không).
 */
export function loginAccount(
  state: State,
  emailOrUsername: string,
  password: string,
): LoginResult {
  const key = emailOrUsername.trim().toLowerCase();
  if (!key || !password) {
    return { ok: false, error: 'Vui lòng nhập email hoặc tên đăng nhập và mật khẩu.' };
  }
  const account = state.accounts.find(
    (a) => a.email.toLowerCase() === key || a.username.toLowerCase() === key,
  );
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return { ok: false, error: 'Email/tên đăng nhập hoặc mật khẩu không đúng.' };
  }
  return { ok: true, account: toPublicAccount(account) };
}

/**
 * Che giữa chuỗi secret (token, khóa API, SĐT...) — chỉ hiện 4 ký tự đầu
 * và 4 ký tự cuối. Chuỗi ngắn (<= 8 ký tự) thì che toàn bộ.
 * Vd: maskSecret('0915528008') -> '0915****8008' — thực tế SĐT người gửi
 * trên nhãn in chỉ hiện 4 số cuối (******8008), xem quy tắc in nhãn.
 */
export function maskSecret(s: string): string {
  if (!s) return '';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(s.length - 8)}${s.slice(-4)}`;
}

/** Tiền tố mã đơn v37. Mã đầy đủ dạng ACH77000xxx (vd ACH77000001). */
const ORDER_CODE_BASE = 77000000;

/**
 * Sinh mã đơn tiếp theo: quét mã lớn nhất đang có, +1, tăng tuần tự.
 * Gọi tuần tự (không song song) để tránh cấp trùng mã.
 */
export function nextOrderCode(state: State): string {
  let max = ORDER_CODE_BASE;
  for (const order of state.orders) {
    const m = /^ACH(\d+)$/.exec(order.code);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `ACH${max + 1}`;
}
