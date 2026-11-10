// Khuyến mãi: mã giảm giá + cấu hình loyalty.
import React, { useState } from 'react';
import { callAction, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { ConfirmButton } from '../components';

export default function PromotionsView({ data, shopKey, refresh, toast }: AppContext) {
  const coupons = data.coupons || [];
  const loyalty = data.loyaltyConfig || { vndPerPoint: 10000, pointValueVnd: 500, tiers: [] };
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState(0);
  const [isPercent, setIsPercent] = useState(false);
  const [vndPerPoint, setVndPerPoint] = useState(loyalty.vndPerPoint ?? 10000);
  const [pointValueVnd, setPointValueVnd] = useState(loyalty.pointValueVnd ?? 500);
  const [busy, setBusy] = useState(false);

  const createCoupon = async () => {
    if (!code.trim()) { toast('Nhập mã coupon.'); return; }
    setBusy(true);
    try {
      await callAction('saverecord', { kind: 'coupon', record: { code: code.trim().toUpperCase(), amount, isPercent, enabled: true, shopKey } }, shopKey);
      setCode(''); setAmount(0);
      toast(`Đã tạo mã ${code.trim().toUpperCase()}.`);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Tạo mã thất bại');
    } finally { setBusy(false); }
  };

  const saveLoyalty = async () => {
    try {
      await callAction('saveloyaltyconfig', { vndPerPoint, pointValueVnd, tiers: loyalty.tiers || [] }, shopKey);
      toast('Đã lưu cấu hình loyalty.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu cấu hình thất bại');
    }
  };

  return (
    <div>
      <div className="card">
        <h3>Mã giảm giá</h3>
        <div className="toolbar">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Mã — vd: GIAM10K" style={{ width: 200 }} />
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="Số tiền giảm (đ)" style={{ width: 180 }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>Giảm theo %
            <input type="checkbox" checked={isPercent} onChange={(e) => setIsPercent(e.target.checked)} style={{ width: 'auto' }} />
          </label>
          <button className="btn btn-primary" onClick={createCoupon} disabled={busy}>Tạo mã</button>
        </div>
        {coupons.length === 0 ? <div className="empty">Chưa có mã giảm giá nào.</div> : (
          <table className="table">
            <thead><tr><th>Mã</th><th>Giảm</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {coupons.map((c: any) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>{c.isPercent ? `${c.amount}%` : fmtVnd(c.amount)}</td>
                  <td>{c.enabled ? <span className="badge badge-ok">Đang bật</span> : <span className="badge">Đã tắt</span>}</td>
                  <td>
                    <ConfirmButton
                      label="Xóa" confirmText="Bấm lại để xóa thật" className="btn btn-sm btn-danger"
                      onConfirm={async () => { await callAction('deleterecordbykind', { kind: 'coupon', id: c.id }, shopKey); toast('Đã xóa mã.'); await refresh(); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h3>Khách hàng thân thiết (loyalty)</h3>
        <div className="form-grid">
          <label>Số tiền mua để tích 1 điểm (đ)
            <input type="number" min={0} value={vndPerPoint} onChange={(e) => setVndPerPoint(Number(e.target.value) || 0)} />
          </label>
          <label>Giá trị quy đổi của 1 điểm (đ)
            <input type="number" min={0} value={pointValueVnd} onChange={(e) => setPointValueVnd(Number(e.target.value) || 0)} />
          </label>
        </div>
        <h4>Hạng thành viên</h4>
        {(loyalty.tiers || []).length === 0 ? <p className="muted">Chưa có hạng nào.</p> : (
          <table className="table"><thead><tr><th>Hạng</th><th>Mua tối thiểu</th><th>Giảm giá</th></tr></thead>
            <tbody>{(loyalty.tiers || []).map((t: any) => <tr key={t.name}><td>{t.name}</td><td>{fmtVnd(t.minSpent)}</td><td>{t.discountPercent}%</td></tr>)}</tbody></table>
        )}
        <button className="btn btn-primary" onClick={saveLoyalty}>Lưu cấu hình loyalty</button>
      </div>
    </div>
  );
}
