// Tổng quan: thẻ số liệu hôm nay + đơn mới nhất + tồn kho thấp.
import React, { useMemo } from 'react';
import { fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { Money, StatCard, StatusBadge } from '../components';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function OverviewView({ data, shopKey }: AppContext) {
  const orders = data.orders || [];
  const today = startOfToday();
  const stats = useMemo(() => {
    const todayOrders = orders.filter((o) => new Date(o.createdAt) >= today);
    const revenue = todayOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const pairs = todayOrders.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (i.quantity || 0), 0), 0);
    const pending = orders.filter((o) => o.orderStatus === 'cho_duyet').length;
    const shipping = orders.filter((o) => o.orderStatus === 'dang_giao_hang').length;
    return { revenue, pairs, count: todayOrders.length, pending, shipping };
  }, [orders]);

  const recent = [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 8);
  const lowStock = (data.products || [])
    .flatMap((p) => (p.variants || []).map((v) => ({ product: p, variant: v })))
    .filter(({ variant }) => variant.stock >= 0 && variant.stock <= 5)
    .slice(0, 8);
  const unread = (data.conversations || []).filter((c) => {
    const last = (c.messages || [])[(c.messages || []).length - 1];
    return last && last.sender === 'customer';
  }).length;

  return (
    <div>
      <div className="grid-4">
        <StatCard label="Doanh thu hôm nay" value={fmtVnd(stats.revenue)} sub={`${stats.count} đơn • ${stats.pairs} đôi`} />
        <StatCard label="Đơn chờ duyệt" value={String(stats.pending)} sub="Cần xử lý" />
        <StatCard label="Đang giao hàng" value={String(stats.shipping)} sub="Đã đẩy hãng" />
        <StatCard label="Hội thoại chờ trả lời" value={String(unread)} sub="Tin cuối là của khách" />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Đơn mới nhất — {shopKey || 'tất cả shop'}</h3>
          {recent.length === 0 ? (
            <div className="empty">Chưa có đơn hàng nào. Shop mới bắt đầu trống hoàn toàn.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Mã đơn</th><th>Khách</th><th>Tổng COD</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id || o.code}>
                    <td className="mono">{o.code}</td>
                    <td>{o.customerName}<br /><span className="muted small">{o.customerPhone}</span></td>
                    <td><Money value={o.totalAmount} /></td>
                    <td><StatusBadge status={o.orderStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Tồn kho sắp hết (≤ 5)</h3>
          {lowStock.length === 0 ? (
            <div className="empty">Không có biến thể nào sắp hết (hoặc shop không quản lý tồn kho).</div>
          ) : (
            <table className="table">
              <thead><tr><th>Sản phẩm</th><th>Biến thể</th><th>Tồn</th></tr></thead>
              <tbody>
                {lowStock.map(({ product, variant }) => (
                  <tr key={variant.sku}>
                    <td>{product.name}</td>
                    <td>{variant.color} {variant.size}<br /><span className="mono small muted">{variant.sku}</span></td>
                    <td><span className="badge badge-danger">{variant.stock}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Fanpage đã kết nối</h4>
          {(data.fanpages || []).length === 0 ? (
            <p className="muted">Chưa kết nối fanpage nào. Vào Cài đặt → Kết nối Meta để nối page.</p>
          ) : (
            <ul>
              {(data.fanpages || []).map((f) => (
                <li key={f.id}>{f.name} <span className="muted">({f.pageId})</span> — {f.connected ? 'Đã kết nối' : 'Chưa kết nối'}</li>
              ))}
            </ul>
          )}
          <p className="muted small">Cập nhật: {fmtDate(new Date().toISOString())}</p>
        </div>
      </div>
    </div>
  );
}
