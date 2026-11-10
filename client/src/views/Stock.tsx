// Kho hàng: nhập/xuất/kiểm kê/chuyển kho + công nợ nhà cung cấp.
import React, { useState } from 'react';
import { callAction, fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';

export default function StockView({ data, shopKey, refresh, toast }: AppContext) {
  const records = [...(data.stockRecords || [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const debts = data.supplierDebts || [];
  const products = data.products || [];
  const [tab, setTab] = useState<'in' | 'out' | 'audit'>('in');
  const [productId, setProductId] = useState('');
  const [variantSku, setVariantSku] = useState('');
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const product = products.find((p) => p.id === productId);
  const variants = product?.variants || [];

  const submit = async () => {
    if (!productId || !variantSku || qty <= 0) { toast('Chọn sản phẩm, biến thể và số lượng > 0.'); return; }
    setBusy(true);
    try {
      if (tab === 'in') await callAction('applystockin', { productId, sku: variantSku, quantity: qty, unitCost, reason: reason.trim(), shopKey }, shopKey);
      else if (tab === 'out') await callAction('applystockbatch', { kind: 'out', lines: [{ productId, sku: variantSku, quantity: qty }], reason: reason.trim(), shopKey }, shopKey);
      else await callAction('applystockaudit', { productId, sku: variantSku, counted: qty, reason: reason.trim(), shopKey }, shopKey);
      toast(tab === 'in' ? 'Đã nhập kho.' : tab === 'out' ? 'Đã xuất kho.' : 'Đã kiểm kê.');
      setQty(1); setReason('');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Thao tác kho thất bại');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card">
        <div className="tabs">
          <button className={`tab ${tab === 'in' ? 'active' : ''}`} onClick={() => setTab('in')}>Nhập kho</button>
          <button className={`tab ${tab === 'out' ? 'active' : ''}`} onClick={() => setTab('out')}>Xuất kho</button>
          <button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>Kiểm kê</button>
        </div>
        <div className="form-grid">
          <label>Sản phẩm
            <select value={productId} onChange={(e) => { setProductId(e.target.value); setVariantSku(''); }}>
              <option value="">— Chọn sản phẩm —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Biến thể
            <select value={variantSku} onChange={(e) => setVariantSku(e.target.value)} disabled={!product}>
              <option value="">— Màu × size —</option>
              {variants.map((v) => <option key={v.sku} value={v.sku}>{v.color} {v.size} (tồn {v.stock < 0 ? '—' : v.stock})</option>)}
            </select>
          </label>
          <label>{tab === 'audit' ? 'Số lượng đếm được' : 'Số lượng'}
            <input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} />
          </label>
          {tab === 'in' && (
            <label>Giá nhập / đôi (đ)
              <input type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value) || 0)} />
            </label>
          )}
          <label>Lý do
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="vd: Nhập hàng đợt 11/11" />
          </label>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{tab === 'in' ? 'Nhập kho' : tab === 'out' ? 'Xuất kho' : 'Lưu kiểm kê'}</button>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Phiếu kho gần đây</h3>
          {records.length === 0 ? <div className="empty">Chưa có phiếu kho nào.</div> : (
            <table className="table"><thead><tr><th>Loại</th><th>Sản phẩm</th><th>SL</th><th>Ngày</th></tr></thead>
              <tbody>{records.slice(0, 15).map((r: any) => <tr key={r.id}><td>{r.kind || r.type}</td><td>{r.productName || r.sku || ''}</td><td>{r.quantity ?? r.counted ?? '—'}</td><td>{fmtDate(r.createdAt)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h3>Công nợ nhà cung cấp</h3>
          {debts.length === 0 ? <div className="empty">Chưa có công nợ nào.</div> : (
            <table className="table"><thead><tr><th>Nhà cung cấp</th><th>Còn nợ</th><th></th></tr></thead>
              <tbody>{debts.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.supplierName || d.name}</td>
                  <td>{fmtVnd(d.debt)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={async () => {
                      const amt = Number(window.prompt(`Trả nợ cho ${d.supplierName || d.name} (đ):`, '0') || 0);
                      if (!amt) return;
                      await callAction('paysupplierdebt', { supplierId: d.id, amount: amt, shopKey }, shopKey);
                      toast(`Đã trả ${fmtVnd(amt)}.`);
                      await refresh();
                    }}>Trả nợ</button>
                  </td>
                </tr>
              ))}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
