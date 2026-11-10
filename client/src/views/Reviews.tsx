// Đánh giá: đánh giá sản phẩm của khách, AI phân tích cảm xúc + soạn trả lời,
// lưu trả lời lên đánh giá.
import React, { useMemo, useState } from 'react';
import { callAction, fmtDate } from '../api';
import type { AppContext } from '../appctx';

export default function ReviewsView({ data, shopKey, refresh, toast }: AppContext) {
  const records = (data as any).records || {};
  const reviews = useMemo(() => {
    const list = Object.values(records.review || {}) as any[];
    return list.filter((r) => !shopKey || r.shopKey === shopKey).sort((a, b) => +new Date(b.createdAt || b.updatedAt || 0) - +new Date(a.createdAt || a.updatedAt || 0));
  }, [records, shopKey]);
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  const [rating, setRating] = useState(5);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, any>>({});

  const addReview = async () => {
    if (!text.trim()) { toast('Nhập nội dung đánh giá.'); return; }
    try {
      await callAction('saverecord', { kind: 'review', record: { text: text.trim(), authorName: author.trim() || 'Khách', rating, shopKey, createdAt: new Date().toISOString() } }, shopKey);
      setText(''); setAuthor('');
      toast('Đã lưu đánh giá.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu đánh giá thất bại');
    }
  };

  const analyze = async (r: any) => {
    setAnalyzing(r.id);
    try {
      const res: any = await callAction('aianalyzereview', { review: r.text, reviewId: r.id, shopKey }, shopKey);
      setAnalysis((prev) => ({ ...prev, [r.id]: res }));
      if (res?.reply) {
        await callAction('saverecord', { kind: 'review', record: { ...r, reply: res.reply } }, shopKey);
        await refresh();
      }
    } catch (e: any) {
      toast(e.message || 'Phân tích đánh giá thất bại');
    } finally {
      setAnalyzing(null);
    }
  };

  return (
    <div>
      <div className="card">
        <h3>Thêm đánh giá</h3>
        <div className="toolbar">
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Tên khách…" style={{ width: 200 }} />
          <select value={rating} onChange={(e) => setRating(Number(e.target.value))} style={{ width: 120 }}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} sao</option>)}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nội dung đánh giá…" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={addReview}>Lưu đánh giá</button>
        </div>
      </div>
      {reviews.length === 0 ? (
        <div className="empty">Chưa có đánh giá nào.</div>
      ) : (
        reviews.map((r: any) => (
          <div className="card" key={r.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <b style={{ flex: 1 }}>{r.authorName || 'Khách'} — {'★'.repeat(r.rating || 5)}{'☆'.repeat(5 - (r.rating || 5))}</b>
              <span className="muted small">{fmtDate(r.createdAt || r.updatedAt)}</span>
              <button className="btn btn-sm" disabled={analyzing === r.id} onClick={() => analyze(r)}>✨ AI phân tích &amp; soạn trả lời</button>
            </div>
            <p>{r.text}</p>
            {analysis[r.id] && (
              <div style={{ background: '#f8fafc', borderRadius: 6, padding: 10 }}>
                <b>Cảm xúc:</b> {analysis[r.id].sentiment || analysis[r.id].label || '—'}
                {analysis[r.id].reply && <><br /><b>Trả lời đã soạn:</b> {analysis[r.id].reply}</>}
              </div>
            )}
            {r.reply && !analysis[r.id] && <p className="muted small"><b>Đã trả lời:</b> {r.reply}</p>}
          </div>
        ))
      )}
    </div>
  );
}
