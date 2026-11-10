// Khách hàng: danh sách, tổng tiền đã mua, điểm loyalty, hạng, đổi điểm lấy coupon.
import React, { useMemo, useState } from 'react';
import { callAction, fmtVnd, maskPhone } from '../api';
import type { AppContext } from '../appctx';
import { Money } from '../components';

export default function CustomersView({ data, shopKey, refresh, toast }: AppContext) {
  const customers = data.customers || [];
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q));
  }, [customers, query]);

  const adjustPoints = async (c: any, delta: number) => {
    try {
      await callAction('adjustloyaltypoints', { customerId: c.id, delta, reason: 'Điều chỉnh tay' }, shopKey);
      toast(`Đã ${delta > 0 ? 'cộng' : 'trừ'} ${Math.abs(delta)} điểm cho ${c.name}.`);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Điều chỉnh điểm thất bại');
    }
  };

  const redeem = async (c: any) => {
    try {
      const r: any = await callAction('redeempointsforcoupon', { customerId: c.id }, shopKey);
      toast(`Đã đổi điểm lấy coupon ${r?.coupon?.code || r?.code || ''}.`);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Đổi điểm thất bại');
    }
  };

  return (
    <div>
      <div className="toolbar">
        <input placeholder="Tìm tên / SĐT khách…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 260 }} />
        <span className="muted">{filtered.length} khách hàng</span>
        <span className="muted small">Tích điểm: {data.loyaltyConfig?.vndPerPoint?.toLocaleString('vi-VN') || '10.000'}đ = 1 điểm • 1 điểm = {data.loyaltyConfig?.pointValueVnd?.toLocaleString('vi-VN') || '500'}đ</span>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">Chưa có khách hàng nào.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Tên</th><th>SĐT</th><th>Địa chỉ</th><th>Đã mua</th><th>Điểm</th><th>Hạng</th><th></th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{maskPhone(c.phone)}</td>
                  <td>{c.address || '—'}</td>
                  <td><Money value={c.totalSpent} /></td>
                  <td>{c.loyaltyPoints ?? 0}</td>
                  <td><span className="badge">{c.loyaltyTier || 'thuong'}</span></td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => adjustPoints(c, 10)}>+10 điểm</button>{' '}
                    <button className="btn btn-sm" onClick={() => redeem(c)}>Đổi coupon</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
