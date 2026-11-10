// Trợ lý AI (Omni-Chat): chat với trợ lý theo shop, dạy AI (train chat),
// quy tắc AI, chăm sóc tự động sau X phút im lặng.
import React, { useEffect, useRef, useState } from 'react';
import { callAction } from '../api';
import type { AppContext } from '../appctx';

export default function AIView({ data, shopKey, refresh, toast }: AppContext) {
  const [tab, setTab] = useState<'chat' | 'train' | 'rules' | 'care'>('chat');
  const [messages, setMessages] = useState<Array<{ role: string; text: string }>>([
    { role: 'ai', text: 'Trợ lý AI AChatGo — hỏi về đơn hàng, sản phẩm, phí ship của shop. Trả lời dựa trên catalogue và quy tắc thật của shop, không bịa giá.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [trainInput, setTrainInput] = useState('');
  const [trainTurns, setTrainTurns] = useState<any[]>([]);
  const [proposed, setProposed] = useState<any | null>(null);
  const [care, setCare] = useState<any>({ enabled: false, minutes: 5, message: '' });
  const [careLoaded, setCareLoaded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current && (boxRef.current.scrollTop = boxRef.current.scrollHeight);
  }, [messages]);

  const loadTrain = async () => {
    try {
      const r: any = await callAction('gettrainchat', { shopKey }, shopKey);
      setTrainTurns(r?.turns || r?.chat || []);
    } catch { /* chưa có lịch sử */ }
  };
  const loadCare = async () => {
    if (careLoaded) return;
    setCareLoaded(true);
    try {
      const r: any = await callAction('getcaresettings', { shopKey }, shopKey);
      if (r) setCare({ enabled: !!r.enabled, minutes: r.minutes ?? 5, message: r.message || '' });
    } catch { /* mặc định */ }
  };
  useEffect(() => { loadTrain(); loadCare(); }, []);

  const sendChat = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const r: any = await callAction('assistantchat', { message: text, shopKey }, shopKey);
      setMessages((m) => [...m, { role: 'ai', text: r?.reply || r?.answer || r?.message || '(không có câu trả lời)' }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'ai', text: `Lỗi: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const sendTrain = async () => {
    const text = trainInput.trim();
    if (!text) return;
    setTrainInput('');
    setBusy(true);
    try {
      const r: any = await callAction('trainchat', { message: text, shopKey }, shopKey);
      setProposed(r?.proposedRule || r?.rule || null);
      await loadTrain();
      toast(r?.proposedRule ? 'AI đã đề xuất 1 quy tắc — xem và xác nhận ở dưới.' : 'Đã dạy AI.');
    } catch (e: any) {
      toast(e.message || 'Dạy AI thất bại');
    } finally {
      setBusy(false);
    }
  };

  const confirmRule = async () => {
    if (!proposed) return;
    try {
      await callAction('confirmtrainrule', { rule: proposed, shopKey }, shopKey);
      setProposed(null);
      toast('Đã lưu quy tắc AI cho shop.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu quy tắc thất bại');
    }
  };

  const saveCare = async () => {
    try {
      await callAction('savecaresettings', { shopKey, ...care }, shopKey);
      toast('Đã lưu cài đặt chăm sóc tự động.');
    } catch (e: any) {
      toast(e.message || 'Lưu cài đặt thất bại');
    }
  };

  const rules = data.aiRules || [];

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>Trợ lý AI</button>
        <button className={`tab ${tab === 'train' ? 'active' : ''}`} onClick={() => setTab('train')}>Dạy AI</button>
        <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>Quy tắc AI ({rules.length})</button>
        <button className={`tab ${tab === 'care' ? 'active' : ''}`} onClick={() => setTab('care')}>Chăm sóc tự động</button>
      </div>

      {tab === 'chat' && (
        <div>
          <div className="ai-chat-box" ref={boxRef}>
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role === 'user' ? 'mine' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
            ))}
            {busy && <div className="chat-msg">AI đang trả lời…</div>}
          </div>
          <div className="ai-chat-row">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Nhập câu hỏi…" onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
            <button className="btn btn-primary" onClick={sendChat} disabled={busy}>Gửi</button>
          </div>
          <p className="muted small">Trợ lý dùng khóa AI riêng của shop (Super Admin gán). Hết credit thì bot trả lời bằng mẫu.</p>
        </div>
      )}

      {tab === 'train' && (
        <div className="card">
          <p>Dạy AI bằng câu chữ thường — vd: “khách hỏi size 40 thì trả lời chỉ có size 36–39”. AI đề xuất quy tắc, chị xác nhận thì quy tắc mới có hiệu lực (chỉ áp cho shop này).</p>
          <div className="ai-chat-row" style={{ marginTop: 0 }}>
            <input value={trainInput} onChange={(e) => setTrainInput(e.target.value)} placeholder="Nhập điều chị muốn dạy AI…" onKeyDown={(e) => { if (e.key === 'Enter') sendTrain(); }} />
            <button className="btn btn-primary" onClick={sendTrain} disabled={busy}>Dạy</button>
          </div>
          {proposed && (
            <div style={{ marginTop: 12, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: 12 }}>
              <b>Quy tắc AI đề xuất:</b>
              <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(proposed, null, 2)}</pre>
              <div className="toolbar">
                <button className="btn btn-primary" onClick={confirmRule}>Xác nhận &amp; lưu quy tắc</button>
                <button className="btn" onClick={() => setProposed(null)}>Bỏ qua</button>
              </div>
            </div>
          )}
          <h4>Lịch sử dạy AI</h4>
          {trainTurns.length === 0 ? <p className="muted">Chưa có lượt dạy nào.</p> : (
            <ul>{trainTurns.slice(-10).reverse().map((t: any, i: number) => <li key={i}>{t.message || t.text || JSON.stringify(t)}</li>)}</ul>
          )}
        </div>
      )}

      {tab === 'rules' && (
        <div className="card">
          {rules.length === 0 ? <div className="empty">Shop chưa có quy tắc AI nào.</div> : (
            <table className="table">
              <thead><tr><th>Tên</th><th>Từ khóa</th><th>Trả lời mẫu</th><th>Bật</th><th></th></tr></thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{(r.keywords || []).join(', ')}</td>
                    <td>{r.reply}</td>
                    <td>{r.enabled ? '✓' : '✕'}</td>
                    <td><button className="btn btn-sm btn-danger" onClick={async () => { await callAction('deleteairule', { id: r.id, shopKey }, shopKey); toast('Đã xóa quy tắc.'); await refresh(); }}>Xóa</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'care' && (
        <div className="card">
          <p>Chăm sóc sau im lặng: mỗi lần automation gửi tin HỎI khách mà đúng X phút sau khách vẫn chưa trả lời → gửi đúng 1 tin thuyết phục rồi thôi. Không áp dụng khi đơn đã chốt, nhân viên đã vào thread, ngoài khung 24h, hoặc tin khách là khiếu nại.</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Bật chăm sóc tự động
            <input type="checkbox" checked={care.enabled} onChange={(e) => setCare({ ...care, enabled: e.target.checked })} style={{ width: 'auto' }} />
          </label>
          <label>Số phút im lặng trước khi nhắn
            <input type="number" min={1} value={care.minutes} onChange={(e) => setCare({ ...care, minutes: Number(e.target.value) || 5 })} />
          </label>
          <label>Nội dung tin chăm sóc
            <textarea rows={3} value={care.message} onChange={(e) => setCare({ ...care, message: e.target.value })} placeholder="vd: Dạ chị ơi, đôi dép chị hỏi vẫn còn đủ size ạ, chị cần em tư vấn thêm gì không ạ?" />
          </label>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={saveCare}>Lưu cài đặt</button>
            <button className="btn" onClick={async () => { try { const r: any = await callAction('runcarenudges', { shopKey }, shopKey); toast(`Đã chạy 1 lượt chăm sóc: ${r?.sent ?? 0} tin đã gửi.`); } catch (e: any) { toast(e.message); } }}>Chạy 1 lượt ngay</button>
          </div>
        </div>
      )}
    </div>
  );
}
