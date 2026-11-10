// Sản phẩm: catalogue theo shop, biến thể màu × size, tồn kho, giá vốn, sửa/xóa.
import React, { useState } from 'react';
import { callAction, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { ConfirmButton, Modal } from '../components';

export default function ProductsView({ data, shopKey, refresh, toast }: AppContext) {
  const products = (data.products || []).filter((p) => !shopKey || p.shopKey === shopKey || p.shopKey === 'shared');
  const [edit, setEdit] = useState<any | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const openEdit = (p: any | null) => {
    setEdit(p);
    setName(p?.name || '');
    setPrice(p?.price || 0);
    setGroupName(p?.groupName || '');
  };

  const save = async () => {
    if (!name.trim()) { toast('Nhập tên sản phẩm.'); return; }
    setBusy(true);
    try {
      await callAction('saveproduct', {
        ...(edit?.id ? { id: edit.id } : {}),
        name: name.trim(),
        price,
        groupName: groupName.trim(),
        shopKey,
      }, shopKey);
      toast(edit ? 'Đã lưu sản phẩm.' : 'Đã thêm sản phẩm.');
      setEdit(null);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu sản phẩm thất bại');
    } finally {
      setBusy(false);
    }
  };

  const updateStock = async (productId: string, sku: string, stock: number) => {
    try {
      await callAction('updatevariantstock', { productId, sku, stock }, shopKey);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Cập nhật tồn kho thất bại');
    }
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => openEdit(null)}>+ Thêm sản phẩm</button>
        <span className="muted">{products.length} sản phẩm — giá bán lẻ/đôi, tồn kho −1 = không quản lý tồn.</span>
      </div>
      {products.length === 0 ? (
        <div className="empty">Shop chưa có sản phẩm nào. Shop mới bắt đầu trống hoàn toàn.</div>
      ) : (
        products.map((p) => (
          <div className="card" key={p.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 style={{ flex: 1, margin: 0 }}>{p.name} — {fmtVnd(p.price)}</h3>
              <span className="badge">{p.groupName || '—'}</span>
              <span className="muted small mono">{p.id}</span>
              <button className="btn btn-sm" onClick={() => openEdit(p)}>Sửa</button>
              <ConfirmButton
                label="Xóa"
                confirmText="Bấm lại để xóa thật"
                className="btn btn-sm btn-danger"
                onConfirm={async () => {
                  await callAction('deleteproduct', { id: p.id }, shopKey);
                  toast(`Đã xóa ${p.name}.`);
                  await refresh();
                }}
              />
            </div>
            <table className="table">
              <thead><tr><th>Màu</th><th>Size</th><th>Tồn kho</th><th>SKU</th><th>Giá vốn</th><th></th></tr></thead>
              <tbody>
                {(p.variants || []).map((v) => (
                  <tr key={v.sku}>
                    <td>{v.color}</td>
                    <td>{v.size}</td>
                    <td>{v.stock < 0 ? '—' : v.stock}</td>
                    <td className="mono">{v.sku}</td>
                    <td>{v.costPrice ? fmtVnd(v.costPrice) : '—'}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          const next = window.prompt(`Tồn kho mới cho ${v.sku} (−1 = không quản lý):`, String(v.stock));
                          if (next !== null) updateStock(p.id, v.sku, Number(next) || 0);
                        }}
                      >Sửa tồn</button>
                    </td>
                  </tr>
                ))}
                {(p.variants || []).length === 0 && <tr><td colSpan={6}>Chưa có biến thể.</td></tr>}
              </tbody>
            </table>
          </div>
        ))
      )}
      {edit !== null && (
        <Modal title={edit?.id ? `Sửa ${edit.name}` : 'Thêm sản phẩm'} onClose={() => setEdit(null)}>
          <label>Tên sản phẩm
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: DÉP QUAI NGANG" />
          </label>
          <label>Nhóm sản phẩm (khớp quy tắc phí ship)
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="vd: Quai ngang" />
          </label>
          <label>Giá bán lẻ 1 đôi (đ)
            <input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
          </label>
          <p className="muted small">Biến thể màu × size quản lý ở màn Kho hàng / nhập qua Super Admin. Giá vốn sửa trong bảng biến thể.</p>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        </Modal>
      )}
    </div>
  );
}
