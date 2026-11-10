// Livestream: phiên live, bình luận live, chốt đơn từ bình luận.
import React, { useState } from 'react';
import { callAction, fmtDate } from '../api';
import type { AppContext } from '../appctx';

export default function LivestreamView({ data, shopKey, refresh, toast, openCreateOrder }: AppContext) {
  const sessions = [...(data.liveSessions || [])].sort((a, b) => +new Date(b.createdAt || b.scheduledAt || 0) - +new Date(a.createdAt || a.scheduledAt || 0));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [commentText, setCommentText] = useState('');
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const saveSession = async (status?: string) => {
    if (!title.trim() && !activeSession) { toast('Nhập tiêu đề phiên live.'); return; }
    setBusy(true);
    try {
      const r: any = await callAction('savelivesession', {
        ...(activeSession?.id ? { id: activeSession.id } : {}),
        title: title.trim() || activeSession?.title,
        note: note.trim(),
        shopKey,
        ...(status ? { status } : {}),
      }, shopKey);
      toast(r?.session ? 'Đã lưu phiên live.' : 'Đã lưu phiên live.');
      setActiveSession(null); setTitle(''); setNote('');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu phiên live thất bại');
    } finally { setBusy(false); }
  };

  const addComment = async () => {
    if (!commentText.trim() || !activeSession) return;
    try {
      await callAction('addlivecomment', { sessionId: activeSession.id, text: commentText.trim(), shopKey }, shopKey);
      setCommentText('');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Thêm bình luận thất bại');
    }
  };

  const comments = (activeSession?.comments || []) as any[];

  return (
    <div>
      <div className="card">
        <h3>Phiên livestream mới</h3>
        <p className="muted small">Quản lý phiên nội bộ — app không phát sóng thật, không tự lấy bình luận Facebook/TikTok/Shopee; nhập bình luận tay rồi chốt đơn từ bình luận.</p>
        <div className="toolbar">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề phiên live…" style={{ flex: 1 }} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú / sản phẩm lên live…" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => saveSession()} disabled={busy}>Tạo phiên</button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Danh sách phiên</h3>
          {sessions.length === 0 ? <div className="empty">Chưa có phiên livestream nào.</div> : (
            <table className="table">
              <thead><tr><th>Tiêu đề</th><th>Trạng thái</th><th>Bắt đầu</th><th></th></tr></thead>
              <tbody>
                {sessions.map((s: any) => (
                  <tr key={s.id}>
                    <td>{s.title}</td>
                    <td><span className="badge">{s.status}</span></td>
                    <td>{fmtDate(s.startedAt || s.scheduledAt)}</td>
                    <td className="nowrap">
                      <button className="btn btn-sm" onClick={() => { setActiveSession(s); setTitle(s.title || ''); setNote(s.note || ''); }}>Mở</button>{' '}
                      {s.status !== 'live' && <button className="btn btn-sm" onClick={async () => { await callAction('startlivesession', { sessionId: s.id }, shopKey); toast('Đã bắt đầu phiên live.'); await refresh(); }}>Bắt đầu</button>}{' '}
                      {s.status === 'live' && <button className="btn btn-sm" onClick={async () => { await callAction('endlivesession', { sessionId: s.id }, shopKey); toast('Đã kết thúc phiên live.'); await refresh(); }}>Kết thúc</button>}{' '}
                      <button className="btn btn-sm btn-danger" onClick={async () => { await callAction('deletelivesession', { sessionId: s.id }, shopKey); toast('Đã xóa phiên.'); await refresh(); }}>Xóa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>{activeSession ? `Bình luận live — ${activeSession.title}` : 'Chưa chọn phiên'}</h3>
          {!activeSession ? (
            <div className="empty">Chọn một phiên để xem / nhập bình luận và chốt đơn.</div>
          ) : (
            <>
              <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 10 }}>
                {comments.length === 0 ? <div className="empty">Chưa có bình luận nào trong phiên này.</div> : comments.map((c: any, i: number) => (
                  <div key={c.id || i} className="chat-msg" style={{ maxWidth: '100%', marginBottom: 6 }}>
                    <b>{c.authorName || c.author || 'Khách'}:</b> {c.text}
                    <span className="msg-time">{fmtDate(c.createdAt)} {c.ordered ? `• Đã chốt đơn ${c.orderCode || ''}` : ''}</span>
                    {!c.ordered && (
                      <div style={{ marginTop: 6 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => openCreateOrder({ customerName: c.authorName || c.author || '', note: `Chốt từ bình luận live: ${c.text}` })}>Chốt đơn từ bình luận</button>{' '}
                        <button className="btn btn-sm" onClick={async () => { await callAction('deletelivecomment', { sessionId: activeSession.id, commentId: c.id }, shopKey); await refresh(); }}>Xóa</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="ai-chat-row" style={{ marginTop: 0 }}>
                <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Nhập bình luận tay…" onKeyDown={(e) => { if (e.key === 'Enter') addComment(); }} />
                <button className="btn btn-primary" onClick={addComment}>Thêm</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
