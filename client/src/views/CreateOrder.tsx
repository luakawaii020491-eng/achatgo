// Tạo đơn mới — cửa sổ toàn màn hình 3 cột kiểu Sapo (F1 mở, F8 lưu).
// Cột trái: hội thoại của khách (chỉ xem) hoặc bộ chọn hội thoại khi mở từ F1.
// Cột giữa: chọn sản phẩm (Top bán chạy) + dòng hàng + tab Khách hàng riêng.
// Cột phải: thông tin khách, ghi chú, thanh toán, giao hàng, chi tiết thanh toán.
// Nút AI tròn đặt góc dưới-trái, KHÔNG che cột phải.
// Backend không đổi: payload createorder giữ nguyên (items: productId/sku/color/size/
// quantity/price; tổng COD do server tính lại).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { callAction, fmtDate, fmtVnd, maskPhone } from '../api';
import type { AppContext, CreateOrderPrefill } from '../appctx';
import { computeOrderTotals } from '../pricing';
import type { Conversation, Product } from '../types';

interface Line { productId: string; variantSku: string; quantity: number; price: number; }
const blankLine = (): Line => ({ productId: '', variantSku: '', quantity: 1, price: 0 });

type DeliveryMethod = 'later' | 'pickup' | 'carrier' | 'external';
const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  later: 'Giao hàng sau',
  pickup: 'Nhận tại cửa hàng',
  carrier: 'Đẩy qua ĐTVC',
  external: 'Đẩy vận chuyển ngoài',
};

/** So sánh không dấu để tìm sản phẩm / hội thoại. */
const fold = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function CreateOrderView({ ctx, prefill, conversation, onClose }: { ctx: AppContext; prefill?: CreateOrderPrefill; conversation?: Conversation; onClose: () => void }) {
  const { data, shopKey, refresh, toast } = ctx;
  const products = useMemo(() => (data.products || []).filter((p) => p.shopKey === shopKey || shopKey === ''), [data.products, shopKey]);
  const shopRules = (data.shipFeeRulesByShop || {})[shopKey] || [];
  const globalRules = data.shipFeeRules || [];
  const shop = (data.shops || []).find((s) => s.key === shopKey);

  // Hội thoại đang xem ở cột trái (từ chat, hoặc chọn trong bộ chọn).
  const [chatConv, setChatConv] = useState<Conversation | undefined>(conversation);
  const [pickConvQuery, setPickConvQuery] = useState('');
  useEffect(() => { if (conversation) setChatConv(conversation); }, [conversation]);
  const conversations = useMemo(
    () => [...(data.conversations || [])]
      .filter((c) => !c.shopKey || c.shopKey === shopKey)
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [data.conversations, shopKey],
  );
  const messages = useMemo(
    () => [...(chatConv?.messages || [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [chatConv],
  );
  const lastMsg = messages.length ? messages[messages.length - 1] : undefined;
  const chatBottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ block: 'end' }); }, [chatConv?.id, messages.length]);

  const [tab, setTab] = useState<'order' | 'customer'>('order');
  const [customerName, setCustomerName] = useState(prefill?.customerName || '');
  const [phone, setPhone] = useState(prefill?.phone || '');
  const [address, setAddress] = useState(prefill?.address || '');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [ward, setWard] = useState('');
  const [note, setNote] = useState(prefill?.note || '');
  const [lines, setLines] = useState<Line[]>(() => {
    if (prefill?.items && prefill.items.length > 0) {
      return prefill.items.map((it) => {
        // Đơn trích xuất từ AI chỉ có sku — dò productId theo sku để dòng không bị rớt khi lưu.
        const bySku = it.sku ? products.find((p) => (p.variants || []).some((v) => v.sku === it.sku)) : undefined;
        return { productId: it.productId || bySku?.id || '', variantSku: it.sku || '', quantity: it.quantity || 1, price: it.price ?? bySku?.price ?? 0 };
      });
    }
    return [blankLine()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  const [discount, setDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Giao hàng + thanh toán (ghi vào ghi chú đơn — không thêm action backend).
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('later');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'bank'>('cod');
  const [payNote, setPayNote] = useState('');
  const [showPayExtra, setShowPayExtra] = useState(false);

  // Bộ chọn sản phẩm.
  const [pickerQuery, setPickerQuery] = useState('');
  const [multiMode, setMultiMode] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const pickerProducts = useMemo(() => {
    const q = fold(pickerQuery.trim());
    if (!q) return products;
    return products.filter((p) => fold(p.name).includes(q) || fold(p.groupName || '').includes(q) || (p.variants || []).some((v) => fold(v.sku).includes(q)));
  }, [products, pickerQuery]);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);

  // Khi đổi hội thoại ở cột trái: điền tên/SĐT từ hội thoại nếu đang trống.
  useEffect(() => {
    if (!chatConv) return;
    const ph = (chatConv as any).phone || '';
    setCustomerName((prev) => prev || chatConv.customerName || '');
    setPhone((prev) => prev || ph);
  }, [chatConv]);

  useEffect(() => { nameRef.current?.focus(); }, []);

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

  const isNewCustomer = useMemo(() => {
    const ph = phone.trim();
    const nm = customerName.trim();
    if (!ph && !nm) return true;
    return !(data.customers || []).some((c) => (ph && c.phone === ph) || (nm && c.name === nm));
  }, [data.customers, phone, customerName]);

  const sellable = (p: Product) => {
    const vs = p.variants || [];
    if (!vs.length) return null;
    const unlimited = vs.some((v) => (v.stock ?? 0) < 0);
    const total = vs.reduce((s, v) => s + Math.max(0, v.stock || 0), 0);
    return { total, unlimited };
  };

  const addProductLine = (p: Product) => {
    const vs = p.variants || [];
    const def = vs.find((v) => (v.stock ?? 0) > 0) || vs[0];
    const line: Line = { productId: p.id, variantSku: def?.sku || '', quantity: 1, price: p.price || 0 };
    setLines((prev) => {
      const blankIdx = prev.findIndex((l) => !l.productId);
      if (blankIdx >= 0) return prev.map((l, i) => (i === blankIdx ? line : l));
      return [...prev, line];
    });
    toast(`Đã thêm ${p.name} vào đơn`);
  };
  const togglePick = (id: string) => setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const addPicked = () => {
    pickedIds.forEach((id) => {
      const p = products.find((x) => x.id === id);
      if (p) addProductLine(p);
    });
    setPickedIds([]);
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
      const baseNote = note.trim() || noteFromLines;
      const finalNote = [
        baseNote,
        `Giao hàng: ${DELIVERY_LABELS[deliveryMethod]}${deliveryDate ? ` (hẹn ${deliveryDate})` : ''}`,
        `Thanh toán: ${paymentMethod === 'cod' ? 'COD' : 'Chuyển khoản'}${payNote.trim() ? ` — ${payNote.trim()}` : ''}`,
      ].filter(Boolean).join('\n');
      const r: any = await callAction('createorder', {
        customerName: customerName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        province: province.trim() || undefined,
        district: district.trim() || undefined,
        ward: ward.trim() || undefined,
        note: finalNote,
        discount,
        items,
        fromChat: !!(prefill?.conversationId || chatConv?.id),
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

  const focusAddress = () => {
    setTab('customer');
    window.setTimeout(() => addressRef.current?.focus(), 60);
  };
  const focusDiscount = () => {
    setTab('order');
    window.setTimeout(() => discountRef.current?.focus(), 60);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); save(); }
      if (e.key === 'F1') { e.preventDefault(); save(); }
      if (e.key === 'F2') { e.preventDefault(); focusAddress(); }
      if (e.key === 'Escape') onClose();
      if (e.key === 'F6') { e.preventDefault(); fillNoteByAI(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, customerName, phone, address, note, discount, province, district, ward, deliveryMethod, deliveryDate, paymentMethod, payNote]);

  const setLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const onPickProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLine(idx, { productId, variantSku: '', price: p?.price || 0 });
  };
  // Dòng hàng trống (chưa chọn SP) có productId '' -> p là undefined;
  // phải chịu undefined, nếu không render lần đầu đã throw TypeError
  // (mất cả app vì không có error boundary) — bug trắng màn 10-11.
  const productOptions = (p: Product | undefined) => p?.variants || [];

  const filteredConvs = useMemo(() => {
    const q = fold(pickConvQuery.trim());
    const list = conversations.slice(0, 30);
    if (!q) return list;
    return list.filter((c) => fold(c.customerName || '').includes(q) || fold((c.messages || [])[(c.messages || []).length - 1]?.text || '').includes(q));
  }, [conversations, pickConvQuery]);

  return (
    <div className="create-order-overlay">
      <div className="create-order-header">
        <h2>Tạo đơn mới{shop ? ` — ${shop.name}` : shopKey ? ` — ${shopKey}` : ''}{chatConv ? ` • ${chatConv.customerName || 'Khách'}` : ''}</h2>
        <span className="muted small">
          Mở <span className="kbd">F1</span> • Lưu <span className="kbd">F8</span> • Địa chỉ <span className="kbd">F2</span> • AI điền ghi chú <span className="kbd">F6</span> • Đóng <span className="kbd">Esc</span>
        </span>
        <button className="btn" onClick={onClose}>Đóng</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu đơn (F8)'}</button>
      </div>

      <div className="create-order-body co-3pane">
        {/* ============ CỘT TRÁI — hội thoại khách hàng ============ */}
        <div className="co-chat">
          {chatConv ? (
            <>
              <div className="co-chat-head">
                <div className="co-chat-avatar">{(chatConv.customerName || 'K').trim().charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{chatConv.customerName || 'Khách'}</b>
                  <div className="muted small">{(chatConv as any).phone ? maskPhone((chatConv as any).phone) : `PSID ${chatConv.customerPsid || '—'}`}</div>
                </div>
                <a className="small" href={`https://m.me/${chatConv.customerPsid}`} target="_blank" rel="noreferrer">Xem trang cá nhân</a>
                <button className="btn btn-sm" onClick={() => setChatConv(undefined)}>Đổi hội thoại</button>
              </div>
              <div className="co-chat-messages">
                {messages.length === 0 && <div className="empty">Chưa có tin nhắn nào trong hội thoại này.</div>}
                {messages.map((m) => {
                  const text = m.text || '';
                  const atts = (m as any).attachments as any[] | undefined;
                  const isSystem = /đã trả lời một quảng cáo|đã gửi một tin nhắn|đã xem|đã thích/i.test(text);
                  if (isSystem) return <div key={m.id} className="co-sysnote">{text}</div>;
                  return (
                    <div key={m.id} className={`chat-msg ${m.sender === 'customer' ? '' : 'mine'}`}>
                      {text || (atts?.length ? '[Hình ảnh / tệp đính kèm]' : '—')}
                      {atts?.length ? <span className="msg-time">📎 {atts.length} tệp đính kèm</span> : null}
                      <span className="msg-time">{m.sender === 'customer' ? 'Khách' : m.sender === 'bot' ? 'AI' : 'Shop'} • {fmtDate(m.createdAt)}</span>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>
              <div className="co-chat-tags">
                {chatConv.orderClosed ? <span className="badge badge-ok">ĐÃ CHỐT ĐƠN</span> : <span className="badge badge-warn">CHƯA CHỐT</span>}
                {lastMsg?.sender === 'customer' && <span className="badge badge-accent">ĐANG CHỜ TRẢ LỜI</span>}
                <span className="muted small">Tất cả nhãn</span>
              </div>
              <div className="co-chat-input">
                <input disabled placeholder="Nhắn trong tab Hội thoại để trả lời khách…" />
                <button className="btn btn-primary" disabled>Gửi</button>
              </div>
            </>
          ) : (
            <>
              <div className="co-chat-head"><b style={{ flex: 1 }}>Chọn hội thoại</b></div>
              <div style={{ padding: '10px 12px 0' }}>
                <input value={pickConvQuery} onChange={(e) => setPickConvQuery(e.target.value)} placeholder="Tìm theo tên khách / nội dung…" />
              </div>
              <div className="co-picker-list">
                {filteredConvs.length === 0 ? (
                  <div className="empty">Không có hội thoại nào.</div>
                ) : (
                  filteredConvs.map((c) => {
                    const last = (c.messages || [])[(c.messages || []).length - 1];
                    return (
                      <div key={c.id} className="co-product-row" onClick={() => setChatConv(c)}>
                        <span className="co-thumb co-thumb-fallback">{(c.customerName || 'K').trim().charAt(0).toUpperCase()}</span>
                        <span className="co-product-info">
                          <b>{c.customerName || 'Khách'}</b>
                          <span className="muted small">{last?.text || '—'}</span>
                          <span className="muted small">{c.orderClosed ? 'Đã chốt đơn' : fmtDate(c.updatedAt)}</span>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
              <p className="muted small" style={{ padding: '0 12px 12px' }}>Chọn một hội thoại để xem khách đã đặt gì khi lên đơn.</p>
            </>
          )}
        </div>

        {/* ============ CỘT GIỮA — chọn sản phẩm + dòng hàng ============ */}
        <div className="co-main">
          <div className="card co-picker">
            <div className="co-picker-head">
              <b>Tạo đơn</b>
              <label className="co-inline-label">Chi nhánh
                <select value={shopKey} disabled><option value={shopKey}>{shop?.name || shopKey || 'Shop'}</option></select>
              </label>
              <label className="co-inline-label">Bảng giá
                <select value="retail" disabled><option value="retail">Giá bán lẻ</option></select>
              </label>
            </div>
            <div className="co-picker-search">
              <input value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Tìm kiếm sản phẩm" />
              <button className={`btn ${multiMode ? 'btn-primary' : ''}`} onClick={() => { setMultiMode((v) => !v); setPickedIds([]); }}>Chọn nhiều</button>
            </div>
            {multiMode && pickedIds.length > 0 && (
              <div className="co-multi-bar">
                <span>Đã chọn {pickedIds.length} sản phẩm</span>
                <button className="btn btn-sm btn-primary" onClick={addPicked}>Thêm vào đơn</button>
                <button className="btn btn-sm" onClick={() => setPickedIds([])}>Bỏ chọn</button>
              </div>
            )}
            <div className="co-picker-list">
              <div className="co-picker-section"><span className="badge badge-ok">Top bán chạy</span></div>
              {pickerProducts.length === 0 ? (
                <div className="empty">Không tìm thấy sản phẩm.</div>
              ) : (
                pickerProducts.map((p) => {
                  const sell = sellable(p);
                  const sku = (p.variants || [])[0]?.sku || p.id;
                  const picked = pickedIds.includes(p.id);
                  return (
                    <div key={p.id} className={`co-product-row ${picked ? 'selected' : ''}`} onClick={() => (multiMode ? togglePick(p.id) : addProductLine(p))}>
                      {p.image
                        ? <img className="co-thumb" src={p.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        : <span className="co-thumb co-thumb-fallback">{(p.name || '?').trim().charAt(0).toUpperCase()}</span>}
                      <span className="co-product-info">
                        <b>{p.name}</b>
                        <span className="mono small" style={{ color: 'var(--accent-dark)' }}>{sku}</span>
                        <span className="muted small">Có thể bán: {sell ? (sell.unlimited && sell.total === 0 ? 'Không giới hạn' : sell.total) : '—'}</span>
                      </span>
                      <b className="co-product-price">{fmtVnd(p.price)}</b>
                    </div>
                  );
                })
              )}
            </div>
          </div>

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
                            {productOptions(p).map((v) => (
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
                  <input ref={discountRef} type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} />
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
              <label>Địa chỉ (ghi theo địa chỉ cũ trước sáp nhập) <span className="kbd">F2</span>
                <textarea ref={addressRef} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Số nhà, đường, thôn/xóm, xã, huyện, tỉnh…" />
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

        {/* ============ CỘT PHẢI — khách hàng / thanh toán / giao hàng ============ */}
        <div className="co-side">
          <h3>Khách hàng {isNewCustomer && <span className="badge badge-accent">MỚI</span>}</h3>
          <p><b>{customerName || '—'}</b><br /><span className="muted">SĐT: {phone || '—'}</span></p>
          <div className="co-field">
            <div className="co-field-head">
              <b>Địa chỉ <span className="kbd">F2</span></b>
              <a href="#" onClick={(e) => { e.preventDefault(); focusAddress(); }}>Xin thông tin giao hàng</a>
            </div>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
              {address || 'Chưa có địa chỉ'}{province || district || ward ? ` — ${[ward, district, province].filter(Boolean).join(', ')}` : ''}
            </p>
          </div>
          <div className="co-field">
            <b>Ghi chú đơn hàng</b>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Khách đặt: 1 đôi 36 đen + 1 đôi 37 trắng" />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="btn btn-sm" onClick={fillNoteByAI} disabled={aiBusy}>{aiBusy ? 'Đang điền…' : '✨ AI điền ghi chú (F6)'}</button>
              <button className="btn btn-sm" onClick={() => setNote(noteFromLines)}>Điền từ dòng hàng</button>
            </div>
          </div>
          <div className="co-field">
            <b>Xác nhận thanh toán</b>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cod' | 'bank')} style={{ marginTop: 6 }}>
              <option value="cod">COD — thu tiền khi giao hàng</option>
              <option value="bank">Chuyển khoản</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPayExtra((v) => !v)}>+ Thêm phương thức</button>
            {showPayExtra && <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="vd: Đã cọc 50k qua Vietcombank" style={{ marginTop: 6 }} />}
          </div>
          <div className="co-field">
            <b>Giao hàng</b>
            <label style={{ display: 'block', marginTop: 6 }}>Ngày hẹn giao
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </label>
            <div className="co-delivery">
              {(Object.keys(DELIVERY_LABELS) as DeliveryMethod[]).map((m) => (
                <label key={m} className={`co-delivery-opt ${deliveryMethod === m ? 'active' : ''}`}>
                  <input type="radio" name="co-delivery" checked={deliveryMethod === m} onChange={() => setDeliveryMethod(m)} />
                  {DELIVERY_LABELS[m]}
                </label>
              ))}
            </div>
          </div>
          <h3>Chi tiết thanh toán <a href="#" className="small" onClick={(e) => { e.preventDefault(); focusDiscount(); }}>Khuyến mãi</a></h3>
          <div className="co-total-row"><span>Tổng tiền ({lines.filter((l) => l.productId).length} sản phẩm)</span><b>{fmtVnd(totals.goodsTotal)}</b></div>
          <div className="co-total-row"><span>Thuế VAT</span><b>{fmtVnd(0)}</b></div>
          <div className="co-total-row"><span>Chiết khấu</span><b>−{fmtVnd(discount)}</b></div>
          <div className="co-total-row"><span>Phí vận chuyển</span><b>{totals.shippingFee === 0 ? 'Miễn phí' : fmtVnd(totals.shippingFee)}</b></div>
          <div className="co-total-row grand"><span>Khách phải trả</span><span>{fmtVnd(totals.totalAmount)}</span></div>
          <p className="muted small">Phí ship tính theo quy tắc của shop (theo loại SP / từng SP, miễn ship từ 2 đôi với quai ngang, sục 3 phân, rọ đan lưới). Tổng COD cuối cùng do server tính lại khi lưu.</p>
          <div className="co-actions">
            <button className="btn" onClick={onClose}>Hủy</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Tạo đơn (F1)'}</button>
          </div>
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
