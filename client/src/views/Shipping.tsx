// Vận chuyển: đẩy đơn sang hãng, theo dõi vận đơn, kiểm tra phí hợp đồng,
// đối soát COD. GHN / GHTK / Viettel Post / Best đã nối thật.
// J&T CHƯA nối thật (đang chờ duyệt developer) — luôn báo UNSUPPORTED_PUSH.
import React, { useState } from 'react';
import { callAction, fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { Money } from '../components';

const CARRIERS = ['GHN', 'GHTK', 'Viettel Post', 'Best'];

export default function ShippingView({ data, shopKey, refresh, toast }: AppContext) {
  const orders = (data.orders || []).filter((o) => o.carrier || o.waybillCode || o.orderStatus === 'cho_lay_hang' || o.orderStatus === 'dang_giao_hang');
  const [busy, setBusy] = useState('');
  const [trackResult, setTrackResult] = useState<any | null>(null);

  const run = async (key: string, fn: () => Promise<any>, okMsg?: string | ((r: any) => string)) => {
    setBusy(key);
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await refresh();
      return r;
    } catch (e: any) {
      toast(e.message || 'Thao tác thất bại');
      return null;
    } finally {
      setBusy('');
    }
  };

  const track = async (o: any) => {
    const r = await run(`track-${o.code}`, () => callAction('trackwaybill', { orderId: o.id || o.code, waybillCode: o.waybillCode, carrier: o.carrier }, shopKey));
    if (r) setTrackResult({ order: o, ...r });
  };

  const carriers = data.carriers || [];
  return (
    <div>
      <div className="card">
        <p>
          Hãng đã nối thật: <b>GHN, GHTK, Viettel Post, Best</b> (Best có hợp đồng 12.000đ/đơn — duy nhất đã ký).
          {' '}<b>J&T chưa nối thật</b> — chứng thực nhà phát triển đã nộp, đang chờ duyệt; đẩy J&T sẽ trả <span className="mono">UNSUPPORTED_PUSH</span>, không bịa mã vận đơn.
        </p>
        <div className="toolbar">
          <button className="btn" disabled={busy !== ''} onClick={() => run('scan-cod', () => callAction('scancodreconciliation', {}, shopKey), 'Đã quét đối soát COD cho các hãng chưa có webhook.')}>Quét đối soát COD</button>
          <span className="muted small">Người gửi trên nhãn: tên shop + địa chỉ điểm lấy hàng; SĐT người gửi/người nhận đều ẩn 6 số đầu, chỉ hiện 4 số cuối.</span>
        </div>
        <h4>Trạng thái kết nối hãng</h4>
        {carriers.length === 0 ? (
          <p className="muted">Chưa có cấu hình hãng nào — vào Cài đặt → Vận chuyển để nhập API hãng.</p>
        ) : (
          <table className="table"><thead><tr><th>Hãng</th><th>Kết nối</th><th>API</th></tr></thead>
            <tbody>{carriers.map((c: any) => <tr key={c.id}><td>{c.name}</td><td>{c.connected ? <span className="badge badge-ok">Đã kết nối</span> : <span className="badge">Chưa kết nối</span>}</td><td className="muted small">{c.apiBaseUrl || '—'}</td></tr>)}</tbody></table>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Mã đơn</th><th>Khách</th><th>Hãng</th><th>Mã vận đơn</th><th>Trạng thái giao</th><th>Phí hãng</th><th>COD cần thu</th><th></th></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={8}><div className="empty">Chưa có đơn nào đã đẩy hãng.</div></td></tr>}
            {orders.map((o) => (
              <tr key={o.id || o.code}>
                <td className="mono">{o.code}<br /><span className="muted small">{fmtDate(o.createdAt)}</span></td>
                <td>{o.customerName}<br /><span className="muted small">{o.customerPhone}</span></td>
                <td>{o.carrier || '—'}</td>
                <td className="mono">{o.waybillCode || '—'}</td>
                <td>{(o as any).deliveryStatus || o.orderStatus}</td>
                <td>{(o as any).carrierFee != null ? fmtVnd((o as any).carrierFee) : '—'}</td>
                <td><Money value={o.remainingCod} /></td>
                <td className="nowrap">
                  {o.waybillCode && <><button className="btn btn-sm" disabled={busy !== ''} onClick={() => track(o)}>Tra cứu</button>{' '}
                  <button className="btn btn-sm" disabled={busy !== ''} onClick={() => run(`refresh-${o.code}`, () => callAction('refreshwaybillstatus', { orderId: o.id || o.code, waybillCode: o.waybillCode, carrier: o.carrier }, shopKey), 'Đã làm mới trạng thái vận đơn.')}>Làm mới</button>{' '}
                  <button className="btn btn-sm" disabled={busy !== ''} onClick={() => run(`print-${o.code}`, async () => { const r: any = await callAction('printcarrierwaybill', { orderId: o.id || o.code, code: o.code }, shopKey); if (r?.url) window.open(r.url, '_blank'); return r; }, 'Đã mở nhãn vận đơn.')}>In nhãn</button>{' '}
                  <button className="btn btn-sm btn-danger" disabled={busy !== ''} onClick={() => run(`cancel-${o.code}`, () => callAction('cancelwaybill', { orderId: o.id || o.code, waybillCode: o.waybillCode, carrier: o.carrier }, shopKey), 'Đã hủy vận đơn tại hãng.')}>Hủy vận đơn</button></>}
                  {!o.waybillCode && CARRIERS.map((c) => (
                    <button key={c} className="btn btn-sm" disabled={busy !== ''} onClick={() => run(`push-${o.code}-${c}`, () => callAction('pushorderstocarrier', { orderIds: [o.id || o.code], carrier: c }, shopKey), `Đã đẩy đơn ${o.code} sang ${c}.`)}>Đẩy {c}</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trackResult && (
        <div className="card">
          <h3>Kết quả tra cứu — {trackResult.order?.code} ({trackResult.order?.carrier} {trackResult.order?.waybillCode})</h3>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 6, maxHeight: 320, overflowY: 'auto' }}>
            {JSON.stringify(trackResult, null, 2)}
          </pre>
          <button className="btn" onClick={() => setTrackResult(null)}>Đóng</button>
        </div>
      )}
    </div>
  );
}
