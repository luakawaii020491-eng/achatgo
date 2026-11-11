// Trợ lý AI (Omni-Chat): chat với trợ lý theo shop, dạy AI (train chat),
// quy tắc AI, chăm sóc tự động sau X phút im lặng.
// v43: chat có nút tải ảnh lên; tab Dạy AI đọc được file Excel mẫu
// (parse .xlsx phía client rồi gửi text từng sheet cho AI học theo đúng shop).
import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { callAction } from '../api';
import type { AppContext } from '../appctx';

type ChatMsg = { role: string; text: string; image?: string };

export default function AIView({ data, shopKey, refresh, toast }: AppContext) {
  const [tab, setTab] = useState<'chat' | 'train' | 'rules' | 'care'>('chat');
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'ai', text: 'Trợ lý AI AChatGo — hỏi về đơn hàng, sản phẩm, phí ship của shop. Trả lời dựa trên catalogue và quy tắc thật của shop, không bịa giá.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState<{ dataUrl: string; name: string; mime: string } | null>(null);
  const [trainInput, setTrainInput] = useState('');
  const [trainTurns, setTrainTurns] = useState<any[]>([]);
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [proposed, setProposed] = useState<any | null>(null);
  const [care, setCare] = useState<any>({ enabled: false, minutes: 5, message: '' });
  const [careLoaded, setCareLoaded] = useState(false);
  const [excelFile, setExcelFile] = useState<{ name: string; sheets: Array<{ name: string; lines: number; text: string }> } | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    boxRef.current && (boxRef.current.scrollTop = boxRef.current.scrollHeight);
  }, [messages]);

  const loadTrain = async () => {
    try {
      const r: any = await callAction('gettrainchat', { shopKey }, shopKey);
      setTrainTurns(r?.items || r?.turns || r?.chat || []);
      setKnowledge(r?.knowledge || (data as any)?.aiKnowledge || []);
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

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Chỉ gửi được file ảnh (jpg/png/webp).'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Ảnh quá lớn (tối đa 5MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => setAttach({ dataUrl: String(reader.result || ''), name: file.name, mime: file.type || 'image/jpeg' });
    reader.readAsDataURL(file);
  };

  const sendChat = async () => {
    const text = input.trim();
    if (!text && !attach) return;
    const img = attach;
    setInput('');
    setAttach(null);
    setMessages((m) => [...m, { role: 'user', text: text || '(đã gửi 1 ảnh)', image: img?.dataUrl }]);
    setBusy(true);
    try {
      const args: Record<string, any> = { message: text, shopKey };
      if (img) {
        args.imageDataBase64 = img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl;
        args.imageMimeType = img.mime;
        args.imageFileName = img.name;
      }
      const r: any = await callAction('assistantchat', args, shopKey);
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
      toast(r?.proposedRule ? 'AI đã đề xuất 1 quy tắc — xem và xác nhận ở dưới.' : 'Đã dạy AI — AI sẽ dùng nội dung này khi trả lời khách của shop.');
    } catch (e: any) {
      toast(e.message || 'Dạy AI thất bại');
    } finally {
      setBusy(false);
    }
  };

  const confirmRule = async () => {
    if (!proposed) return;
    try {
      await callAction('confirmtrainrule', { trainChatId: proposed.trainChatId || proposed.id, shopKey }, shopKey);
      setProposed(null);
      toast('Đã lưu quy tắc AI cho shop.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu quy tắc thất bại');
    }
  };

  const onPickExcel = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx?$|\.xls$/i.test(file.name)) { toast('Chọn file Excel (.xlsx/.xls).'); return; }
    setExcelBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheets: Array<{ name: string; lines: number; text: string }> = [];
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const lines = rows
          .map((r) => r.map((c) => String(c ?? '').trim()).filter(Boolean).join(' | '))
          .filter((l) => l.length > 0);
        if (lines.length === 0) continue;
        sheets.push({ name, lines: lines.length, text: lines.join('\n').slice(0, 12000) });
      }
      if (sheets.length === 0) { toast('File Excel không có nội dung (các sheet đều trống).'); return; }
      setExcelFile({ name: file.name, sheets });
    } catch (e: any) {
      toast(`Đọc file Excel thất bại: ${e.message || 'file lỗi'}`);
    } finally {
      setExcelBusy(false);
    }
  };

  const sendExcel = async () => {
    if (!excelFile) return;
    setExcelBusy(true);
    try {
      const r: any = await callAction('trainexcel', { fileName: excelFile.name, sheets: excelFile.sheets, shopKey }, shopKey);
      toast(`Đã dạy AI từ file ${excelFile.name}: ${r?.sheets || excelFile.sheets.length} sheet, ${r?.lines || 0} dòng — AI trả lời khách theo đúng Page/sản phẩm trong file.`);
      setExcelFile(null);
      await loadTrain();
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Dạy AI từ file Excel thất bại');
    } finally {
      setExcelBusy(false);
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
              <div key={i} className={`chat-msg ${m.role === 'user' ? 'mine' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>
                {m.image && <img src={m.image} alt="ảnh đính kèm" className="chat-img" />}
                {m.text}
              </div>
            ))}
            {busy && <div className="chat-msg">AI đang trả lời…</div>}
          </div>
          {attach && (
            <div className="attach-preview">
              <img src={attach.dataUrl} alt={attach.name} />
              <span className="small">{attach.name}</span>
              <button className="btn btn-sm" onClick={() => setAttach(null)}>Bỏ ảnh</button>
            </div>
          )}
          <div className="ai-chat-row">
            <input type="file" accept="image/*" ref={imgInputRef} style={{ display: 'none' }} onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ''; }} />
            <button className="btn" title="Tải ảnh lên" onClick={() => imgInputRef.current?.click()}>📷 Ảnh</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Nhập câu hỏi…" onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }} />
            <button className="btn btn-primary" onClick={sendChat} disabled={busy}>Gửi</button>
          </div>
          <p className="muted small">Trợ lý dùng khóa AI riêng của shop (Super Admin gán). Hết credit thì bot trả lời bằng mẫu. Ảnh gửi lên để hỏi về mẫu trong ảnh — trợ lý ghi nhận ảnh và trả lời theo nội dung chị mô tả thêm.</p>
        </div>
      )}

      {tab === 'train' && (
        <div className="card">
          <p>Dạy AI bằng câu chữ thường — vd: “khách hỏi size 40 thì trả lời chỉ có size 36–39”. AI ghi lại kiến thức và dùng khi trả lời khách của đúng shop này. Dạy bằng cặp câu hỏi + câu trả lời thì AI đề xuất quy tắc, chị xác nhận thì quy tắc mới có hiệu lực (chỉ áp cho shop này).</p>
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

          <h4 style={{ marginTop: 20 }}>Dạy AI bằng file Excel mẫu</h4>
          <p className="muted small">Tải file Excel mẫu dạy AI lên — AI đọc các sheet (hướng dẫn, danh sách page &amp; sản phẩm, kịch bản trả lời, ví dụ, ảnh gửi kèm) rồi trả lời khách theo đúng Page, đúng sản phẩm, đúng giá/size/màu trong file, không tự bịa. File mẫu: 5 sheet, tải ở mục “Dạy AI”.</p>
          <input type="file" accept=".xlsx,.xls" ref={xlsxInputRef} style={{ display: 'none' }} onChange={(e) => { onPickExcel(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="toolbar">
            <button className="btn" onClick={() => xlsxInputRef.current?.click()} disabled={excelBusy}>{excelBusy ? 'Đang đọc file…' : '📄 Chọn file Excel (.xlsx)'}</button>
            {excelFile && <button className="btn btn-primary" onClick={sendExcel} disabled={excelBusy}>Dạy AI từ file này</button>}
            {excelFile && <button className="btn" onClick={() => setExcelFile(null)}>Bỏ file</button>}
          </div>
          {excelFile && (
            <div style={{ marginTop: 12 }}>
              <b>{excelFile.name}</b>
              <ul>
                {excelFile.sheets.map((s) => (
                  <li key={s.name}>{s.name} — {s.lines} dòng</li>
                ))}
              </ul>
              <pre className="small" style={{ whiteSpace: 'pre-wrap', background: '#f7fafc', border: '1px solid var(--border-soft)', borderRadius: 8, padding: 10, maxHeight: 220, overflowY: 'auto' }}>
                {excelFile.sheets.map((s) => `── ${s.name} ──\n${s.text.split('\n').slice(0, 6).join('\n')}`).join('\n\n').slice(0, 2000)}
              </pre>
            </div>
          )}

          <h4>Kiến thức AI đã học ({knowledge.length})</h4>
          {knowledge.length === 0 ? <p className="muted">Chưa có kiến thức nào từ file Excel hay câu dạy tay.</p> : (
            <ul>{knowledge.slice(0, 10).map((k: any) => (
              <li key={k.id}>{k.source === 'excel' ? `📊 Excel: ${k.fileName || ''}${k.sheet ? ` — ${k.sheet}` : ''}` : '💬 Câu dạy tay'} — <span className="muted small">{k.preview || ''}</span></li>
            ))}</ul>
          )}
          <h4>Lịch sử dạy AI</h4>
          {trainTurns.length === 0 ? <p className="muted">Chưa có lượt dạy nào.</p> : (
            <ul>{trainTurns.slice(-10).reverse().map((t: any, i: number) => <li key={i}>{t.source === 'excel' ? `📊 ${t.question}` : (t.question || t.message || t.text || JSON.stringify(t))}{t.answer ? ` → ${t.answer}` : ''}</li>)}</ul>
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
