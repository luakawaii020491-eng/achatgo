// Trả hàng: phiếu trả từ đơn đã giao, duyệt từng bước (nhận hàng → hoàn tiền).
import React, { useState } from 'react';
import { callAction, fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';

export default function ReturnsView({ data, shopKey, refresh, toast }: AppContext) {
  const slips = [...(data.returnSlips || [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const delivered = (data.orders || []).filter((o) => o.orderStatus === 'da_giao_hang');
  const [orderCode, setOrderCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!orderCode.trim()) { toast('Chọn đơn đã giao để tạo phiếu trả.'); return; }
    setBusy(true);
    try {
      await callAction('createreturnslip', { orderCode: orderCode.trim(), reason: reason.trim(), shopKey }, shopKey);
      setOrderCode(''); setReason('');
      toast('Đã tạo phiếu trả hàng.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Tạo phiếu trả thất bại');
    } finally { setBusy(false); }
  };

  const advance = async (slip: any, step: string) => {
    setBusy(true);
    try {
      await callAction('advancereturnslip', { slipId: slip.id, step, shopKey }, shopKey);
      toast(`Phiếu ${slip.code || slip.id}: ${step}`);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Duyệt phiếu thất bại');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card">
        <h3>Tạo phiếu trả hàng</h3>
        <p className="muted small">Chỉ tạo từ đơn đã giao. Hàng sai mô tả → trả lại không mất phí; hàng đúng mô tả nhưng khách không lấy → khách chịu 20k ship hoàn.</p>
        <div className="toolbar">
          <select value={orderCode} onChange={(e) => setOrderCode(e.target.value)} style={{ minWidth: 260 }}>
            <option value="">— Chọn đơn đã giao —</option>
            {delivered.map((o) => <option key={o.id} value={o.code}>{o.code} — {o.customerName} ({fmtVnd(o.totalAmount)})</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do trả…" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={create} disabled={busy}>Tạo phiếu trả</button>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Mã phiếu</th><th>Đơn gốc</th><th>Trạng thái</th><th>Tiền hoàn</th><th>Ngày tạo</th><th></th></tr></thead>
          <tbody>
            {slips.length === 0 && <tr><td colSpan={6}><div className="empty">Chưa có phiếu trả hàng nào.</div></td></tr>}
            {slips.map((s: any) => (
              <tr key={s.id}>
                <td className="mono">{s.code || s.id}</td>
                <td className="mono">{s.orderCode || ''}</td>
                <td><span className="badge">{s.status}</span></td>
                <td>{s.refundAmount != null ? fmtVnd(s.refundAmount) : '—'}</td>
                <td>{fmtDate(s.createdAt)}</td>
                <td className="nowrap">
                  <button className="btn btn-sm" disabled={busy} onClick={() => advance(s, 'Đã nhận hàng trả')}>Đã nhận hàng trả</button>{' '}
                  <button className="btn btn-sm" disabled={busy} onClick={() => advance(s, 'Đã hoàn tiền')}>Đã hoàn tiền</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
