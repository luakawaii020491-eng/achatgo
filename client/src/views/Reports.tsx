// Báo cáo: doanh thu theo ngày / theo sản phẩm, xuất CSV.
import React, { useMemo, useState } from 'react';
import { fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { Money, StatCard } from '../components';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ReportsView({ data }: AppContext) {
  const orders = data.orders || [];
  const products = data.products || [];
  const [days, setDays] = useState(7);

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }, [days]);

  const inRange = useMemo(() => orders.filter((o) => new Date(o.createdAt) >= since), [orders, since]);
  const revenue = inRange.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const pairs = inRange.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (i.quantity || 0), 0), 0);
  const delivered = inRange.filter((o) => o.orderStatus === 'da_giao_hang').length;
  const cancelled = inRange.filter((o) => o.orderStatus === 'da_huy').length;

  const byDay = useMemo(() => {
    const m = new Map<string, { count: number; revenue: number; pairs: number }>();
    inRange.forEach((o) => {
      const k = dayKey(o.createdAt);
      const row = m.get(k) || { count: 0, revenue: 0, pairs: 0 };
      row.count += 1;
      row.revenue += o.totalAmount || 0;
      row.pairs += (o.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
      m.set(k, row);
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [inRange]);

  const byProduct = useMemo(() => {
    const m = new Map<string, { pairs: number; revenue: number }>();
    inRange.forEach((o) => (o.items || []).forEach((i) => {
      const name = products.find((p) => p.id === i.productId)?.name || i.sku || '—';
      const row = m.get(name) || { pairs: 0, revenue: 0 };
      row.pairs += i.quantity || 0;
      row.revenue += (i.price || 0) * (i.quantity || 0);
      m.set(name, row);
    }));
    return [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  }, [inRange, products]);

  const exportCsv = () => {
    const rows = [['Ngay', 'So don', 'So doi', 'Doanh thu'], ...byDay.map(([d, r]) => [d, String(r.count), String(r.pairs), String(r.revenue)])];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bao-cao-${days}ngay.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="toolbar">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 200 }}>
          <option value={7}>7 ngày qua</option>
          <option value={30}>30 ngày qua</option>
          <option value={90}>90 ngày qua</option>
        </select>
        <button className="btn" onClick={exportCsv}>Xuất CSV</button>
      </div>
      <div className="grid-4">
        <StatCard label="Doanh thu" value={fmtVnd(revenue)} sub={`${days} ngày qua`} />
        <StatCard label="Số đơn" value={String(inRange.length)} sub={`${pairs} đôi`} />
        <StatCard label="Đã giao" value={String(delivered)} sub="đơn" />
        <StatCard label="Đã hủy" value={String(cancelled)} sub="đơn" />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Doanh thu theo ngày</h3>
          {byDay.length === 0 ? <div className="empty">Chưa có đơn trong khoảng này.</div> : (
            <table className="table"><thead><tr><th>Ngày</th><th>Đơn</th><th>Đôi</th><th>Doanh thu</th></tr></thead>
              <tbody>{byDay.map(([d, r]) => <tr key={d}><td>{d}</td><td>{r.count}</td><td>{r.pairs}</td><td><Money value={r.revenue} /></td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h3>Doanh thu theo sản phẩm</h3>
          {byProduct.length === 0 ? <div className="empty">Chưa có đơn trong khoảng này.</div> : (
            <table className="table"><thead><tr><th>Sản phẩm</th><th>Đôi</th><th>Tiền hàng</th></tr></thead>
              <tbody>{byProduct.map(([n, r]) => <tr key={n}><td>{n}</td><td>{r.pairs}</td><td><Money value={r.revenue} /></td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
