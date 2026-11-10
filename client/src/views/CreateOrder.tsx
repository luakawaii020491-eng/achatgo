// Tạo đơn mới — toàn màn hình kiểu Sapo (F1 mở, F8 lưu).
// Cột trái: khách hàng + địa chỉ thông minh + ghi chú (tab Khách hàng riêng).
// Cột giữa: dòng hàng. Cột phải: tổng tiền + AI điền ghi chú.
// Nút AI tròn đặt góc dưới-trái, KHÔNG che cột phải.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { callAction, fmtVnd } from '../api';
import type { AppContext, CreateOrderPrefill } from '../appctx';
import { computeOrderTotals } from '../pricing';
import type { Product } from '../types';

interface Line {
  productId: string;
  variantSku: string;
  quantity: number;
  price: number;
}

const blankLine = (): Line => ({ productId: '', variantSku: '', quantity: 1, price: 0 });

export default function CreateOrderView({
  ctx, prefill, onClose,
}: {
  ctx: AppContext;
  prefill?: CreateOrderPrefill;
  onClose: () => void;
}) {
  const { data, shopKey, refresh, toast } = ctx;
  const products = useMemo(() => (data.products || []).filter((p) => p.shopKey === shopKey || shopKey === ''), [data.products, shopKey]);
  const shopRules = (data.shipFeeRulesByShop || {})[shopKey] || [];
  const globalRules = data.shipFeeRules || [];

  const [tab, setTab] = useState<'order' | 'customer'>('order');
  const [customerName, setCustomerName] = useState(prefill?.customerName || '');
  const [phone, setPhone] = useState(prefill?.phone || '');
  const [address, setAddress] = useState(prefill?.address || '');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [ward, setWard] = useState('');
  const [note, setNote] = useState(prefill?.note || '');
  const [lines, setLines] = useState<Line[]>(() =>
    prefill?.items && prefill.items.length > 0
      ? prefill.items.map((it) => ({ productId: it.productId || '', variantSku: it.sku || '', quantity: it.quantity || 1, price: it.price || 0 }))
      : [blankLine()],
  );
  const [discount, setDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const totals = useMemo(() => {
    const items = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: l.quantity, price: l.price }));
    return computeOrderTotals(products, shopRules, globalRules, items, discount);
  }, [lines, products, shopRules, globalRules, discount]);

  const noteFromLines = useMemo(() => {
    const parts = lines.filter((l) => l.productId).map((l) => {
      const p = products.find((x) => x.id === l.productId);
      const v = (p?.variants || []).find((x) => x.sku === l.variantSku);
      return `${l.quantity} đôi ${v?.size ? `size ${v.size} ` : ''}${v?.color ? `${v.color} ` : ''}${p?.name || ''}`.trim();
    });
    return parts.length ? `Khách đặt: ${parts.join(' + ')}` : '';
  }, [lines, products]);

  const setLine = (idx: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const onPickProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLine(idx, { productId, variantSku: '', price: p?.price || 0 });
  };

  const save = async () => {
    setError('');
    const items = lines
      .filter((l) => l.productId)
      .map((l) => {
        const p = products.find((x) => x.id === l.productId);
        const v = (p?.variants || []).find((x) => x.sku === l.variantSku);
        return { productId: l.productId, sku: l.variantSku || undefined, color: v?.color, size: v?.size, quantity: l.quantity, price: l.price };
      });
    if (items.length === 0) { setError('Chưa chọn sản phẩm nào.'); return; }
    if (!customerName.trim() && !phone.trim()) { setError('Nhập tên hoặc SĐT khách.'); return; }
    setSaving(true);
    try {
      const r: any = await callAction('createorder', {
        customerName: customerName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        province: province.trim() || undefined,
        district: district.trim() || undefined,
        ward: ward.trim() || undefined,
        note: note.trim() || noteFromLines,
        discount,
        items,
        fromChat: !!prefill?.conversationId,
      }, shopKey);
      toast(`Đã tạo đơn ${r?.order?.code || r?.code || ''}.`);
      await refresh();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Tạo đơn thất bại');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); save(); }
      if (e.key === 'Escape') onClose();
      if (e.key === 'F6') { e.preventDefault(); fillNoteByAI(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, customerName, phone, address, note, discount, province, district, ward]);

  const fillNoteByAI = async () => {
    setAiBusy(true);
    try {
      const text = [customerName, phone, address, noteFromLines].filter(Boolean).join(' | ');
      const r: any = await callAction('aiextractorder', { text });
      const extracted = r?.note || r?.orderNote || r?.summary || '';
      if (extracted) setNote(extracted);
      else setNote(noteFromLines);
      toast('Đã điền ghi chú bằng AI.');
    } catch {
      setNote(noteFromLines);
      toast('AI không trích xuất được — đã điền ghi chú từ dòng hàng.');
    } finally {
      setAiBusy(false);
    }
  };

  const askAI = async () => {
    if (!aiText.trim()) return;
    setAiBusy(true);
    try {
      const r: any = await callAction('assistantchat', { message: aiText, context: 'create-order' }, shopKey);
      const reply = r?.reply || r?.answer || r?.message || '';
      if (reply) setNote((prev) => (prev ? `${prev}\n${reply}` : reply));
      setAiText('');
    } catch (e: any) {
      toast(e.message || 'Trợ lý AI lỗi');
    } finally {
      setAiBusy(false);
    }
  };

  const productOptions = (p: Product) => p.variants || [];

  return (
    <div className="create-order-overlay">
      <div className="create-order-header">
        <h2>Tạo đơn mới {shopKey ? `— ${shopKey}` : ''}</h2>
        <span className="muted small">Mở <span className="kbd">F1</span> • Lưu <span className="kbd">F8</span> • AI điền ghi chú <span className="kbd">F6</span> • Đóng <span className="kbd">Esc</span></span>
        <button className="btn" onClick={onClose}>Đóng</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu đơn (F8)'}</button>
      </div>

      <div className="create-order-body">
        <div className="co-main">
          <div className="tabs">
            <button className={`tab ${tab === 'order' ? 'active' : ''}`} onClick={() => setTab('order')}>Đơn hàng</button>
            <button className={`tab ${tab === 'customer' ? 'active' : ''}`} onClick={() => setTab('customer')}>Khách hàng</button>
          </div>
          {error && <div className="error">{error}</div>}

          {tab === 'order' ? (
            <div className="card">
              <table className="table">
                <thead><tr><th>Sản phẩm</th><th>Màu × Size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th></th></tr></thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const p = products.find((x) => x.id === line.productId);
                    return (
                      <tr key={idx}>
                        <td style={{ minWidth: 200 }}>
                          <select value={line.productId} onChange={(e) => onPickProduct(idx, e.target.value)}>
                            <option value="">— Chọn sản phẩm —</option>
                            {products.map((x) => (
                              <option key={x.id} value={x.id}>{x.name} — {fmtVnd(x.price)}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ minWidth: 170 }}>
                          <select value={line.variantSku} onChange={(e) => setLine(idx, { variantSku: e.target.value })} disabled={!p}>
                            <option value="">— Màu × size —</option>
                            {productOptions(p as Product).map((v) => (
                              <option key={v.sku} value={v.sku}>{v.color} {v.size}{v.stock >= 0 ? ` (tồn ${v.stock})` : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td><input type="number" min={1} value={line.quantity} onChange={(e) => setLine(idx, { quantity: Number(e.target.value) || 1 })} style={{ width: 70 }} /></td>
                        <td><input type="number" min={0} value={line.price} onChange={(e) => setLine(idx, { price: Number(e.target.value) || 0 })} style={{ width: 110 }} /></td>
                        <td className="nowrap">{fmtVnd(line.quantity * line.price)}</td>
                        <td><button className="btn btn-danger btn-sm" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [blankLine()]))}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn" onClick={() => setLines((prev) => [...prev, blankLine()])}>+ Thêm dòng hàng</button>
              <div style={{ marginTop: 14 }}>
                <label>Giảm giá (đ)
                  <input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} />
                </label>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="form-grid">
                <label>Tên khách hàng
                  <input ref={nameRef} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Lấy từ nick Facebook, không hỏi lại tên" />
                </label>
                <label>SĐT
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0xxxxxxxxx" />
                </label>
              </div>
              <label>Địa chỉ (ghi theo địa chỉ cũ trước sáp nhập)
                <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Số nhà, đường, thôn/xóm, xã, huyện, tỉnh…" />
              </label>
              <div className="form-grid">
                <label>Tỉnh / Thành phố
                  <input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="vd: Hà Nội" />
                </label>
                <label>Quận / Huyện
                  <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="vd: Long Biên" />
                </label>
                <label>Phường / Xã
                  <input value={ward} onChange={(e) => setWard(e.target.value)} placeholder="vd: Thượng Thanh" />
                </label>
              </div>
              <label>Ghi chú đơn — phải ghi yêu cầu lấy hàng theo đúng lời khách
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Khách đặt: 1 đôi 36 đen + 1 đôi 37 trắng" />
              </label>
              <div className="toolbar">
                <button className="btn" onClick={fillNoteByAI} disabled={aiBusy}>✨ AI điền ghi chú (F6)</button>
                <button className="btn" onClick={() => setNote(noteFromLines)}>Điền từ dòng hàng</button>
              </div>
            </div>
          )}
        </div>

        <div className="co-side">
          <h3>Tổng tiền</h3>
          <div className="co-total-row"><span>Tiền hàng</span><b>{fmtVnd(totals.goodsTotal)}</b></div>
          <div className="co-total-row"><span>Phí ship</span><b>{totals.shippingFee === 0 ? 'Miễn phí' : fmtVnd(totals.shippingFee)}</b></div>
          <div className="co-total-row"><span>Giảm giá</span><b>−{fmtVnd(discount)}</b></div>
          <div className="co-total-row grand"><span>Tổng COD</span><span>{fmtVnd(totals.totalAmount)}</span></div>
          <p className="muted small">Phí ship tính theo quy tắc của shop (theo loại SP / từng SP, miễn ship từ 2 đôi với quai ngang, sục 3 phân, rọ đan lưới). Tổng COD cuối cùng do server tính lại khi lưu.</p>
          <h4>Khách hàng</h4>
          <p>{customerName || '—'}<br /><span className="muted">{phone || 'Chưa có SĐT'}</span><br /><span className="muted small">{address || 'Chưa có địa chỉ'}</span></p>
          <h4>Ghi chú sẽ lưu</h4>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{note || noteFromLines || '—'}</p>
        </div>
      </div>

      {/* Nút AI tròn — góc dưới-trái, không che cột phải */}
      <button className="ai-fab" title="Trợ lý AI" onClick={() => setAiOpen((v) => !v)}>
        <Sparkles size={24} />
      </button>
      {aiOpen && (
        <div className="ai-fab-panel">
          <b>Hỏi trợ lý AI</b>
          <p className="muted small">Hỏi về giá, phí ship, tồn kho của shop — câu trả lời có thể đưa vào ghi chú.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="vd: 2 đôi quai ngang đen 38 giá bao nhiêu?" onKeyDown={(e) => { if (e.key === 'Enter') askAI(); }} />
            <button className="btn btn-primary" onClick={askAI} disabled={aiBusy}>Gửi</button>
          </div>
        </div>
      )}
    </div>
  );
}
