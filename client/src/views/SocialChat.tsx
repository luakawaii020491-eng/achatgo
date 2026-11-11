// Hội thoại — 3 cột kiểu Sapo: danh sách hội thoại | khung chat | cột phải
// (thông tin khách, trích xuất đơn bằng AI, ghi chú nội bộ F6, trả lời nhanh).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { callAction, fmtDate, maskPhone } from '../api';
import type { AppContext } from '../appctx';
import type { Conversation } from '../types';

export default function SocialChatView({ data, shopKey, refresh, toast, openCreateOrder, chatThreadRef }: AppContext & { chatThreadRef?: React.RefObject<HTMLDivElement> }) {
  const conversations = useMemo(
    () => [...(data.conversations || [])].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [data.conversations],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [aiDraft, setAiDraft] = useState('');
  const [extracted, setExtracted] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'info' | 'note'>('info');
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected: Conversation | undefined = conversations.find((c) => c.id === selectedId) || conversations[0];
  const messages = selected?.messages || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedId]);

  useEffect(() => {
    setAiDraft('');
    setExtracted(null);
    setNote((selected as any)?.staffNote || '');
  }, [selectedId]);

  const sync = async () => {
    setSyncing(true);
    try {
      await callAction('syncconversations', {}, shopKey);
      await refresh();
      toast('Đã đồng bộ hội thoại từ Facebook.');
    } catch (e: any) {
      toast(e.message || 'Đồng bộ hội thoại thất bại — kiểm tra token page.');
    } finally {
      setSyncing(false);
    }
  };

  const send = async (text?: string) => {
    const body = (text ?? draft).trim();
    if (!body || !selected) return;
    setSending(true);
    try {
      await callAction('sendchatmessage', { conversationId: selected.id, text: body, customerPsid: selected.customerPsid }, shopKey);
      setDraft('');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Gửi tin thất bại');
    } finally {
      setSending(false);
    }
  };

  const draftByAI = async () => {
    if (!selected) return;
    try {
      const r: any = await callAction('aichat', { conversationId: selected.id }, shopKey);
      setAiDraft(r?.reply || r?.draft || r?.message || '');
    } catch (e: any) {
      toast(e.message || 'AI soạn tin thất bại');
    }
  };

  const extractOrder = async () => {
    if (!selected) return;
    try {
      const text = messages.map((m) => m.text).join('\n');
      const r: any = await callAction('aiextractorder', { text, conversationId: selected.id }, shopKey);
      setExtracted(r);
    } catch (e: any) {
      toast(e.message || 'Trích xuất đơn thất bại');
    }
  };

  const saveNote = async () => {
    if (!selected) return;
    try {
      await callAction('saveconversationnote', { conversationId: selected.id, note }, shopKey);
      toast('Đã lưu ghi chú nội bộ (F6).');
    } catch (e: any) {
      toast(e.message || 'Lưu ghi chú thất bại');
    }
  };

  const quickReplies = (data.quickReplies || []).filter((q: any) => !shopKey || q.shopKey === shopKey);
  const unreadCount = conversations.filter((c) => {
    const last = (c.messages || [])[(c.messages || []).length - 1];
    return last && last.sender === 'customer';
  }).length;

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={sync} disabled={syncing}>{syncing ? 'Đang đồng bộ…' : '⟳ Đồng bộ Facebook'}</button>
        <button className="btn" onClick={async () => { try { await callAction('processaiqueue', {}, shopKey); toast('Đã quét hàng đợi AI.'); await refresh(); } catch (e: any) { toast(e.message); } }}>Chạy hàng đợi AI</button>
        <span className="muted">{conversations.length} hội thoại • {unreadCount} chờ trả lời</span>
        <span className="muted small">AI tự trả lời theo chế độ của shop (tự động / soạn nháp chờ duyệt).</span>
      </div>

      <div className="chat-layout">
        <div className="chat-list">
          {conversations.length === 0 ? (
            <div className="empty">Chưa có hội thoại nào.</div>
          ) : (
            conversations.map((c) => {
              const last = (c.messages || [])[(c.messages || []).length - 1];
              const isUnread = last?.sender === 'customer';
              return (
                <div
                  key={c.id}
                  className={`chat-list-item ${selected?.id === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <b style={{ flex: 1 }}>{c.customerName || 'Khách'}</b>
                    {isUnread && <span className="nav-badge">mới</span>}
                    {c.orderClosed && <span className="badge badge-ok">Đã chốt</span>}
                  </div>
                  <div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {last?.text || '—'}
                  </div>
                  <div className="muted small">{fmtDate(c.updatedAt)}</div>
                </div>
              );
            })
          )}
        </div>

        <div className="chat-thread" ref={chatThreadRef}>
          {!selected ? (
            <div className="empty" style={{ margin: 16 }}>Chọn một hội thoại để xem.</div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <b style={{ flex: 1 }}>{selected.customerName || 'Khách'}</b>
                <span className="muted small mono">{maskPhone((selected as any).phone || '')}</span>
                <button className="btn btn-sm" onClick={extractOrder}>Trích xuất đơn (AI)</button>
                <button className="btn btn-sm btn-primary" onClick={() => openCreateOrder({
                  customerName: selected.customerName,
                  phone: (selected as any).phone || '',
                  conversationId: selected.id,
                }, selected)}>Tạo đơn từ chat</button>
              </div>
              <div className="chat-messages">
                {messages.length === 0 && <div className="empty">Chưa có tin nhắn nào trong hội thoại này.</div>}
                {messages.map((m) => (
                  <div key={m.id} className={`chat-msg ${m.sender === 'customer' ? '' : 'mine'}`}>
                    {m.text}
                    <span className="msg-time">{m.sender === 'customer' ? 'Khách' : m.sender === 'bot' ? 'AI' : 'Shop'} • {fmtDate(m.createdAt)}</span>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              {aiDraft && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-soft)', background: '#fff8e1' }}>
                  <b>Nháp AI:</b> {aiDraft}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => { send(aiDraft); setAiDraft(''); }}>Gửi nháp này</button>
                    <button className="btn btn-sm" onClick={() => setAiDraft('')}>Bỏ nháp</button>
                  </div>
                </div>
              )}
              <div className="chat-input">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Nhập tin nhắn cho khách…"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <button className="btn" onClick={draftByAI}>✨ AI soạn</button>
                <button className="btn btn-primary" onClick={() => send()} disabled={sending}><Send size={16} /> Gửi</button>
              </div>
            </>
          )}
        </div>

        <div className="chat-side">
          <div className="tabs">
            <button className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Khách hàng</button>
            <button className={`tab ${tab === 'note' ? 'active' : ''}`} onClick={() => setTab('note')}>Ghi chú (F6)</button>
          </div>
          {tab === 'info' ? (
            <>
              <h4>Thông tin khách</h4>
              <p><b>{selected?.customerName || '—'}</b><br /><span className="muted">PSID: <span className="mono">{selected?.customerPsid || '—'}</span></span><br /><span className="muted">Page: {(selected as any)?.fanpageId || '—'}</span></p>
              <h4>Trả lời nhanh</h4>
              {quickReplies.length === 0 ? (
                <p className="muted small">Chưa có mẫu trả lời nhanh cho shop này.</p>
              ) : (
                quickReplies.map((q: any) => (
                  <span key={q.id} className="quick-chip" title={q.text} onClick={() => setDraft(q.text)}>{q.title}</span>
                ))
              )}
              <h4>Đơn trích xuất (AI)</h4>
              {extracted ? (
                <div>
                  <pre className="small" style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 10, borderRadius: 6 }}>{JSON.stringify(extracted, null, 2)}</pre>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const items = extracted.items || extracted.lines || [];
                      openCreateOrder({
                        customerName: selected?.customerName,
                        phone: extracted.phone || (selected as any)?.phone || '',
                        address: extracted.address || '',
                        note: extracted.note || '',
                        items: items.map((it: any) => ({ sku: it.sku, color: it.color, size: it.size, quantity: it.quantity || 1, price: it.price })),
                        conversationId: selected?.id,
                      }, selected);
                    }}
                  >Tạo đơn từ trích xuất</button>
                </div>
              ) : (
                <p className="muted small">Bấm “Trích xuất đơn (AI)” để AI đọc hội thoại và tách SĐT, địa chỉ, màu, size, giá.</p>
              )}
            </>
          ) : (
            <>
              <h4>Ghi chú nội bộ (chỉ nhân viên thấy)</h4>
              <textarea rows={8} value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: Khách đặt 1 đôi 36 đen + 1 đôi 37 trắng — nhớ đóng đúng món" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={saveNote}>Lưu ghi chú (F6)</button>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const r: any = await callAction('aisuggestnote', { conversationId: selected?.id }, shopKey);
                      if (r?.note || r?.suggestion) setNote(r.note || r.suggestion);
                    } catch (e: any) { toast(e.message || 'AI gợi ý ghi chú thất bại'); }
                  }}
                >✨ AI gợi ý</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
