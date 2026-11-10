// Bình luận: quét bình luận mới từ các bài viết, trả lời riêng (private reply)
// hoặc trả lời công khai khi Facebook chặn nhắn riêng.
import React, { useState } from 'react';
import { callAction, fmtDate } from '../api';
import type { AppContext } from '../appctx';

export default function CommentsView({ data, shopKey, refresh, toast, openCreateOrder }: AppContext) {
  const comments = [...(data.comments || [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const unread = comments.filter((c: any) => !c.readAt).length;
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState('');

  const sync = async () => {
    setBusy(true);
    try {
      await callAction('synccomments', {}, shopKey);
      toast('Đã quét bình luận mới.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Quét bình luận thất bại — kiểm tra quyền pages_read_engagement.');
    } finally { setBusy(false); }
  };

  const markRead = async (ids: string[]) => {
    try {
      await callAction('markcommentsread', { commentIds: ids }, shopKey);
      await refresh();
    } catch { /* không chặn */ }
  };

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={sync} disabled={busy}>{busy ? 'Đang quét…' : '⟳ Quét bình luận mới'}</button>
        <span className="muted">{comments.length} bình luận • {unread} chưa đọc</span>
        <span className="muted small">Kịch bản tự động (mời vào inbox) chạy theo từng page — cấu hình ở Cài đặt → Bình luận.</span>
      </div>
      {comments.length === 0 ? (
        <div className="empty">Chưa có bình luận nào. Bấm “Quét bình luận mới” để lấy từ các bài viết gần đây.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Người bình luận</th><th>Nội dung</th><th>Bài viết</th><th>Thời gian</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {comments.map((c: any) => (
                <tr key={c.id} style={!c.readAt ? { background: '#fff8e1' } : undefined}>
                  <td>{c.authorName || c.author || '—'}</td>
                  <td>{c.text}</td>
                  <td className="muted small">{c.postExcerpt || c.postId || '—'}</td>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td>{c.readAt ? 'Đã đọc' : <span className="badge badge-warn">Chưa đọc</span>}{c.replied ? ' • Đã trả lời' : ''}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => markRead([c.id])}>Đánh dấu đã đọc</button>{' '}
                    <button className="btn btn-sm" onClick={async () => {
                      const text = replyText || undefined;
                      try {
                        await callAction('pushcommenttoinbox', { commentId: c.id, text }, shopKey);
                        toast('Đã gửi tin mời vào inbox.');
                        await refresh();
                      } catch (e: any) { toast(e.message || 'Không nhắn riêng được — thử trả lời công khai.'); }
                    }}>Mời vào inbox</button>{' '}
                    <button className="btn btn-sm" onClick={async () => {
                      try {
                        await callAction('replycommentpublic', { commentId: c.id, text: replyText || undefined }, shopKey);
                        toast('Đã trả lời công khai.');
                        await refresh();
                      } catch (e: any) { toast(e.message); }
                    }}>Trả lời công khai</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card">
        <h3>Nội dung mời vào inbox (mặc định)</h3>
        <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Để trống dùng tin mẫu của kịch bản page…" />
      </div>
    </div>
  );
}
