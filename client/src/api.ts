// API adapter: mọi thao tác nghiệp vụ đi qua POST /api/action + GET /api/bootstrap
// (x-account-token). Dữ liệu chính lấy bằng action `getbootstrap` (đủ các
// collection mở rộng: comments, liveSessions, returnSlips, tiktok/shopee...).
import type { Account, BootstrapData } from './types';

const TOKEN_KEY = 'achatgo_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {}

async function parseJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({ ok: false, error: 'Server trả về dữ liệu không hợp lệ' }));
  if (!data.ok) throw new ApiError(data.error || 'Lỗi không xác định từ server');
  // Server standalone trả 2 dạng: loginaccount + GET /api/bootstrap bọc payload
  // trong `data`, còn mọi action khác (getbootstrap, createorder, ...) trả các
  // trường trần ở top-level. Trả payload đã bọc khi có, nếu không trả toàn bộ
  // object — khớp kỳ vọng của client (artifact bọc mọi thứ trong `data`).
  return data.data ?? data;
}

/** Gọi 1 action nghiệp vụ. shopKey: null = dùng shop của tài khoản/subdomain. */
export async function callAction<T = any>(action: string, args: Record<string, any> = {}, shopKey?: string | null): Promise<T> {
  const body: Record<string, any> = { action, args };
  if (shopKey) body.shopKey = shopKey;
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-account-token': getToken() },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function login(identifier: string, password: string): Promise<{ token: string; account: Account }> {
  const data = await callAction<{ token: string; account: Account }>('loginaccount', { identifier, password });
  const token = data.token || '';
  if (!token) throw new ApiError('Server không trả token đăng nhập');
  setToken(token);
  return { token, account: data.account };
}

export async function logout(): Promise<void> {
  try {
    await callAction('logoutsession', {});
  } catch {
    // Standalone dùng token = id tài khoản nên logout phía server là no-op;
    // xóa token local là đủ.
  }
  setToken('');
}

/** Tải toàn bộ state đã lọc theo shop (dùng action getbootstrap để đủ collection mở rộng). */
export async function loadBootstrap(): Promise<BootstrapData> {
  try {
    return (await callAction<BootstrapData>('getbootstrap', {})) as BootstrapData;
  } catch {
    // Fallback: endpoint GET /api/bootstrap (chỉ có collection cơ bản).
    const res = await fetch('/api/bootstrap', { headers: { 'x-account-token': getToken() } });
    return parseJson(res) as Promise<BootstrapData>;
  }
}

export const fmtVnd = (n: number | null | undefined): string =>
  `${Number(n || 0).toLocaleString('vi-VN')}đ`;

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const fmtDateShort = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Che 6 số đầu SĐT, chỉ hiện 4 số cuối (quy tắc in nhãn 2026-11-09). */
export const maskPhone = (p: string | null | undefined): string => {
  const s = String(p || '');
  if (s.length <= 4) return s;
  return `******${s.slice(-4)}`;
};

export const esc = (s: unknown): string => String(s ?? '');
