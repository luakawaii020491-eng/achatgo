// Đơn hàng: lọc theo sản phẩm/biến thể/trạng thái, đổi trạng thái theo workflow
// 8 bước, đẩy hãng, in nhãn, xem lịch sử đơn.
import React, { useMemo, useState } from 'react';
import { callAction, fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { ORDER_STATUS_LABELS, type Order } from '../types';
import { ConfirmButton, Modal, Money, StatusBadge } from '../components';

const NEXT_STATUS: Record<string, { to: string; label: string }[]> = {
  cho_duyet: [{ to: 'cho_dong_goi', label: 'Duyệt → Chờ đóng gói' }],
  cho_dong_goi: [{ to: 'cho_lay_hang', label: 'Đóng gói → Chờ lấy hàng' }],
  cho_lay_hang: [{ to: 'dang_giao_hang', label: 'Xuất kho → Đang giao' }],
  dang_giao_hang: [{ to: 'da_giao_hang', label: 'Đã giao hàng' }],
};

export default function OrdersView({ data, refresh, toast, openCreateOrder, shopKey }: AppContext) {
  const orders = data.orders || [];
  const products = data.products || [];
  const [fltProduct, setFltProduct] = useState('');
  const [fltVariant, setFltVariant] = useState('');
  const [fltStatus, setFltStatus] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Order | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');

  const variants = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => (p.variants || []).forEach((v) => s.add(`${p.name} — ${v.color || ''} ${v.size || ''}`.trim())));
    return [...s];
  }, [products]);

  const filtered = useMemo(() => {
    let list = [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    if (fltProduct) list = list.filter((o) => (o.items || []).some((i) => products.find((p) => p.id === i.productId)?.name === fltProduct));
    if (fltVariant) list = list.filter((o) => (o.items || []).some((i) => `${products.find((p) => p.id === i.productId)?.name || ''} — ${i.color || ''} ${i.size || ''}`.trim() === fltVariant));
    if (fltStatus) list = list.filter((o) => o.orderStatus === fltStatus);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((o) => (o.code || '').toLowerCase().includes(q) || (o.customerName || '').toLowerCase().includes(q) || (o.customerPhone || '').includes(q) || (o.waybillCode || '').toLowerCase().includes(q));
    }
    return list;
  }, [orders, products, fltProduct, fltVariant, fltStatus, query]);

  const toggleSelect = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const openDetail = async (o: Order) => {
    setDetail(o);
    try {
      const r = await callAction('getorderhistory', { orderId: o.id || o.code, code: o.code });
      setHistory(Array.isArray(r) ? r : r?.history || r?.events || []);
    } catch {
      setHistory([]);
    }
  };

  const changeStatus = async (o: Order, to: string) => {
    setBusy(o.code);
    try {
      await callAction('changeorderstatus', { orderId: o.id || o.code, code: o.code, toStatus: to, status: to });
      toast(`Đơn ${o.code} → ${ORDER_STATUS_LABELS[to] || to}`);
      await refresh();
      if (detail && detail.code === o.code) setDetail({ ...o, orderStatus: to as Order['orderStatus'] });
    } catch (e: any) {
      toast(e.message || 'Đổi trạng thái thất bại');
    } finally {
      setBusy('');
    }
  };

  const pushCarrier = async (o: Order) => {
    setBusy(o.code);
    try {
      const r: any = await callAction('pushorderstocarrier', { orderIds: [o.id || o.code], carrier: o.carrier || undefined });
      toast(r?.message || `Đã đẩy đơn ${o.code} sang hãng.`);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Đẩy hãng thất bại');
    } finally {
      setBusy('');
    }
  };

  const printWaybill = async (o: Order) => {
    try {
      const r: any = await callAction('printcarrierwaybill', { orderId: o.id || o.code, code: o.code });
      if (r?.url) window.open(r.url, '_blank');
      else if (r?.fileBase64) {
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(`<iframe src="data:${r.fileContentType || 'application/pdf'};base64,${r.fileBase64}" style="width:100%;height:100vh;border:0"></iframe>`);
          w.document.close();
        }
      } else toast('Hãng chưa trả file nhãn.');
      await callAction('recordorderprint', { orderIds: [o.id || o.code], kind: 'label' }).catch(() => null);
    } catch (e: any) {
      toast(e.message || 'In nhãn thất bại');
    }
  };

  const bulkPush = async (carrier: string) => {
    if (selected.size === 0) return;
    setBusy('bulk');
    try {
      const r: any = await callAction('pushorderstocarrier', { orderIds: [...selected], carrier });
      toast(r?.message || `Đã đẩy ${selected.size} đơn sang ${carrier}.`);
      setSelected(new Set());
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Đẩy hàng loạt thất bại');
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <div className="toolbar">
        <select value={fltProduct} onChange={(e) => setFltProduct(e.target.value)}>
          <option value="">Tất cả sản phẩm</option>
          {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        <select value={fltVariant} onChange={(e) => setFltVariant(e.target.value)}>
          <option value="">Tất cả biến thể (màu × size)</option>
          {variants.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fltStatus} onChange={(e) => setFltStatus(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input placeholder="Tìm mã đơn / tên / SĐT / mã vận đơn…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 260 }} />
        <button className="btn btn-primary" onClick={() => openCreateOrder()}>+ Tạo đơn <span className="kbd">F1</span></button>
        {selected.size > 0 && (
          <>
            <span className="muted">Đã chọn {selected.size} đơn</span>
            <button className="btn" disabled={busy === 'bulk'} onClick={() => bulkPush('GHN')}>Đẩy GHN</button>
            <button className="btn" disabled={busy === 'bulk'} onClick={() => bulkPush('GHTK')}>Đẩy GHTK</button>
            <button className="btn" disabled={busy === 'bulk'} onClick={() => bulkPush('BEST')}>Đẩy Best</button>
            <span className="muted small">J&T chưa nối thật — không đẩy J&T.</span>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">Chưa có đơn hàng nào cho shop này.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th></th><th>Mã đơn</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng COD</th><th>Trạng thái</th><th>Vận đơn</th><th></th></tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id || o.code}>
                  <td><input type="checkbox" checked={selected.has(o.id || o.code)} onChange={() => toggleSelect(o.id || o.code)} /></td>
                  <td className="mono">{o.code}<br /><span className="muted small">{fmtDate(o.createdAt)}</span></td>
                  <td>{o.customerName}<br /><span className="muted small">{o.customerPhone}</span></td>
                  <td>{(o.items || []).map((i, idx) => (
                    <div key={idx}>{i.quantity} × {products.find((p) => p.id === i.productId)?.name || ''} {i.color} {i.size}</div>
                  ))}</td>
                  <td><Money value={o.totalAmount} /><br /><span className="muted small">COD còn: {fmtVnd(o.remainingCod)}</span></td>
                  <td><StatusBadge status={o.orderStatus} /></td>
                  <td>{o.carrier ? <>{o.carrier}<br /></> : null}<span className="mono small">{o.waybillCode || '—'}</span></td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => openDetail(o)}>Chi tiết</button>{' '}
                    {(NEXT_STATUS[o.orderStatus] || []).map((n) => (
                      <button key={n.to} className="btn btn-sm" disabled={busy === o.code} onClick={() => changeStatus(o, n.to)}>{n.label}</button>
                    ))}{' '}
                    <button className="btn btn-sm" disabled={busy === o.code} onClick={() => pushCarrier(o)}>Đẩy hãng</button>{' '}
                    {o.waybillCode ? <button className="btn btn-sm" onClick={() => printWaybill(o)}>In nhãn</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <Modal title={`Đơn ${detail.code}`} onClose={() => setDetail(null)} wide>
          <div className="grid-2">
            <div>
              <p><b>Khách:</b> {detail.customerName} — {detail.customerPhone}</p>
              <p><b>Địa chỉ:</b> {detail.customerAddress}</p>
              <p><b>Ghi chú:</b> {detail.note || '—'}</p>
              <p><b>Hãng:</b> {detail.carrier || '—'} • <b>Vận đơn:</b> <span className="mono">{detail.waybillCode || '—'}</span></p>
              <p><b>CAPI:</b> {detail.capiStatus} {detail.capiLog ? <span className="muted">— {detail.capiLog}</span> : null}</p>
              <h4>Dòng hàng</h4>
              <table className="table">
                <thead><tr><th>SP</th><th>Màu</th><th>Size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
                <tbody>
                  {(detail.items || []).map((i, idx) => (
                    <tr key={idx}>
                      <td>{products.find((p) => p.id === i.productId)?.name || i.sku}</td>
                      <td>{i.color}</td><td>{i.size}</td><td>{i.quantity}</td>
                      <td>{fmtVnd(i.price)}</td><td>{fmtVnd(i.price * i.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p><b>Tiền hàng:</b> {fmtVnd(detail.goodsTotal)} • <b>Ship:</b> {fmtVnd(detail.shippingFee)} • <b>Giảm:</b> {fmtVnd(detail.discountAmount)} • <b>Tổng COD:</b> {fmtVnd(detail.totalAmount)}</p>
            </div>
            <div>
              <h4>Lịch sử đơn</h4>
              {history.length === 0 ? <p className="muted">Chưa có lịch sử chi tiết.</p> : (
                <ul>{history.map((h: any, idx: number) => (
                  <li key={idx}>{fmtDate(h.time || h.createdAt)} — {h.action || h.note || h.status || JSON.stringify(h)}</li>
                ))}</ul>
              )}
              <h4>Thao tác</h4>
              <div className="toolbar">
                {(NEXT_STATUS[detail.orderStatus] || []).map((n) => (
                  <button key={n.to} className="btn" disabled={busy === detail.code} onClick={() => changeStatus(detail, n.to)}>{n.label}</button>
                ))}
                <button className="btn" disabled={busy === detail.code} onClick={() => pushCarrier(detail)}>Đẩy hãng</button>
                {detail.waybillCode && <button className="btn" onClick={() => printWaybill(detail)}>In nhãn</button>}
                <ConfirmButton
                  label="Hủy đơn"
                  confirmText="Bấm lại để hủy thật"
                  onConfirm={async () => {
                    await changeStatus(detail, 'da_huy');
                    setDetail(null);
                  }}
                />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
