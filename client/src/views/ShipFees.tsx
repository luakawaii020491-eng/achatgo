// Cài đặt phí ship: quy tắc theo Loại sản phẩm / từng Sản phẩm / tất cả
// (KHÔNG theo Page). Lưu bằng saveshopshipfeerules (riêng từng shop).
import React, { useState } from 'react';
import { callAction, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { Modal } from '../components';

export default function ShipFeesView({ data, shopKey, refresh, toast }: AppContext) {
  const rules = (data.shipFeeRulesByShop || {})[shopKey] || [];
  const globalRules = data.shipFeeRules || [];
  const products = data.products || [];
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', scope: 'group' as 'group' | 'product' | 'all', groupName: '', productId: '', minQty: 1, maxQty: '' as string | number, fee: 30000, enabled: true });

  const openEdit = (r: any | null) => {
    setEdit(r);
    setForm(r ? {
      name: r.name || '', scope: r.scope, groupName: r.groupName || '', productId: r.productId || '',
      minQty: r.minQty ?? 1, maxQty: r.maxQty ?? '', fee: r.fee ?? 0, enabled: r.enabled !== false,
    } : { name: '', scope: 'group', groupName: '', productId: '', minQty: 1, maxQty: '', fee: 30000, enabled: true });
  };

  const save = async () => {
    const rule = {
      ...(edit?.id ? { id: edit.id } : { id: `rule-${Date.now()}` }),
      name: form.name || `${form.scope === 'group' ? form.groupName : form.scope === 'product' ? products.find((p) => p.id === form.productId)?.name : 'Tất cả'} — ${fmtVnd(form.fee)}`,
      scope: form.scope,
      groupName: form.scope === 'group' ? form.groupName || null : null,
      productId: form.scope === 'product' ? form.productId || null : null,
      minQty: Number(form.minQty) || 0,
      maxQty: form.maxQty === '' ? null : Number(form.maxQty),
      fee: Number(form.fee) || 0,
      enabled: form.enabled,
    };
    const next = edit ? rules.map((r) => (r.id === edit.id ? rule : r)) : [...rules, rule];
    try {
      await callAction('saveshopshipfeerules', { shopKey, rules: next }, shopKey);
      toast('Đã lưu quy tắc phí ship.');
      setEdit(null);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu quy tắc thất bại');
    }
  };

  const remove = async (id: string) => {
    const next = rules.filter((r) => r.id !== id);
    try {
      await callAction('saveshopshipfeerules', { shopKey, rules: next }, shopKey);
      toast('Đã xóa quy tắc.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Xóa quy tắc thất bại');
    }
  };

  const pickup = data.shippingConfig?.pickupPoint || { name: '', phone: '', address: '' };
  const [pp, setPp] = useState(pickup);
  const savePickup = async () => {
    try {
      await callAction('savesingleton', { kind: 'shippingConfig', value: { ...data.shippingConfig, pickupPoint: pp } }, shopKey);
      toast('Đã lưu điểm lấy hàng (in trên nhãn vận chuyển).');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu điểm lấy hàng thất bại');
    }
  };

  const groupNames = [...new Set(products.map((p) => p.groupName).filter(Boolean))];

  return (
    <div>
      <div className="card">
        <p>Phí ship theo <b>loại sản phẩm / từng sản phẩm</b> — không theo Page/Fanpage. Quy tắc khớp đầu tiên theo thứ tự danh sách.</p>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => openEdit(null)}>+ Thêm quy tắc</button>
        </div>
        {rules.length === 0 ? (
          <div className="empty">Shop chưa có quy tắc phí ship riêng — đang dùng quy tắc toàn cục / mặc định (1 đôi 30k, từ 2 đôi miễn ship).</div>
        ) : (
          <table className="table">
            <thead><tr><th>Tên</th><th>Phạm vi</th><th>Số lượng</th><th>Phí</th><th>Bật</th><th></th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.scope === 'group' ? `Nhóm: ${r.groupName}` : r.scope === 'product' ? `SP: ${products.find((p) => p.id === r.productId)?.name || r.productId}` : 'Tất cả'}</td>
                  <td>{r.minQty} – {r.maxQty ?? '∞'} đôi</td>
                  <td>{r.fee === 0 ? 'Miễn phí' : fmtVnd(r.fee)}</td>
                  <td>{r.enabled ? '✓' : '✕'}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => openEdit(r)}>Sửa</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {globalRules.length > 0 && (
          <>
            <h4>Quy tắc toàn cục (fallback của Super Admin)</h4>
            <table className="table">
              <thead><tr><th>Tên</th><th>Phạm vi</th><th>Số lượng</th><th>Phí</th></tr></thead>
              <tbody>
                {globalRules.map((r) => (
                  <tr key={r.id}><td>{r.name}</td><td>{r.scope === 'group' ? `Nhóm: ${r.groupName}` : r.scope === 'product' ? `SP: ${r.productId}` : 'Tất cả'}</td><td>{r.minQty} – {r.maxQty ?? '∞'}</td><td>{r.fee === 0 ? 'Miễn phí' : fmtVnd(r.fee)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h3>Điểm lấy hàng (in trên nhãn vận chuyển)</h3>
        <div className="form-grid">
          <label>Tên điểm lấy hàng <input value={pp.name} onChange={(e) => setPp({ ...pp, name: e.target.value })} placeholder="vd: DÉP XINH" /></label>
          <label>SĐT <input value={pp.phone} onChange={(e) => setPp({ ...pp, phone: e.target.value })} /></label>
          <label>Địa chỉ <input value={pp.address} onChange={(e) => setPp({ ...pp, address: e.target.value })} placeholder="Thôn…, Xã…, Tỉnh…" /></label>
        </div>
        <button className="btn btn-primary" onClick={savePickup}>Lưu điểm lấy hàng</button>
      </div>

      {edit !== null && (
        <Modal title={edit?.id ? 'Sửa quy tắc phí ship' : 'Thêm quy tắc phí ship'} onClose={() => setEdit(null)}>
          <label>Tên quy tắc <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Để trống sẽ tự đặt tên" /></label>
          <label>Phạm vi
            <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as any })}>
              <option value="group">Theo loại sản phẩm</option>
              <option value="product">Theo từng sản phẩm</option>
              <option value="all">Tất cả sản phẩm</option>
            </select>
          </label>
          {form.scope === 'group' && (
            <label>Loại sản phẩm
              <select value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })}>
                <option value="">— Chọn loại —</option>
                {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          )}
          {form.scope === 'product' && (
            <label>Sản phẩm
              <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">— Chọn sản phẩm —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <div className="form-grid">
            <label>Từ (đôi) <input type="number" min={0} value={form.minQty} onChange={(e) => setForm({ ...form, minQty: Number(e.target.value) })} /></label>
            <label>Đến (đôi, để trống = không giới hạn) <input type="number" min={0} value={form.maxQty} onChange={(e) => setForm({ ...form, maxQty: e.target.value })} /></label>
            <label>Phí ship (đ, 0 = miễn ship) <input type="number" min={0} value={form.fee} onChange={(e) => setForm({ ...form, fee: Number(e.target.value) })} /></label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Bật quy tắc <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} style={{ width: 'auto' }} /></label>
          <button className="btn btn-primary" onClick={save}>Lưu quy tắc</button>
        </Modal>
      )}
    </div>
  );
}
