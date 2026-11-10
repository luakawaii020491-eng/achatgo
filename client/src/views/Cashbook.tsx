// Sổ quỹ: phiếu thu/chi, số dư suy ra từ toàn bộ phiếu.
import React, { useMemo, useState } from 'react';
import { callAction, fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';
import { Money } from '../components';

export default function CashbookView({ data, shopKey, refresh, toast }: AppContext) {
  const entries = [...(data.cashEntries || [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const balance = useMemo(() => entries.reduce((s, e) => s + (e.kind === 'thu' ? e.amount : -e.amount), 0), [entries]);
  const totalIn = useMemo(() => entries.filter((e) => e.kind === 'thu').reduce((s, e) => s + e.amount, 0), [entries]);
  const totalOut = useMemo(() => entries.filter((e) => e.kind === 'chi').reduce((s, e) => s + e.amount, 0), [entries]);
  const [kind, setKind] = useState<'thu' | 'chi'>('thu');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!amount || amount <= 0) { toast('Nhập số tiền > 0.'); return; }
    setBusy(true);
    try {
      await callAction('createcashentry', { kind, amount, note: note.trim(), shopKey }, shopKey);
      setAmount(0); setNote('');
      toast('Đã ghi phiếu.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Ghi phiếu thất bại');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="grid-4">
        <div className="stat-card"><div className="stat-label">Số dư</div><div className="stat-value">{fmtVnd(balance)}</div></div>
        <div className="stat-card"><div className="stat-label">Tổng thu</div><div className="stat-value" style={{ color: 'var(--ok)' }}>{fmtVnd(totalIn)}</div></div>
        <div className="stat-card"><div className="stat-label">Tổng chi</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{fmtVnd(totalOut)}</div></div>
        <div className="stat-card"><div className="stat-label">Số phiếu</div><div className="stat-value">{entries.length}</div></div>
      </div>
      <div className="card">
        <h3>Ghi phiếu mới</h3>
        <div className="toolbar">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'thu' | 'chi')} style={{ width: 140 }}>
            <option value="thu">Phiếu thu</option>
            <option value="chi">Phiếu chi</option>
          </select>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="Số tiền (đ)" style={{ width: 180 }} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú…" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={create} disabled={busy}>Ghi phiếu</button>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Mã</th><th>Loại</th><th>Số tiền</th><th>Ghi chú</th><th>Ngày</th></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={5}><div className="empty">Chưa có phiếu thu/chi nào.</div></td></tr>}
            {entries.map((e: any) => (
              <tr key={e.id}>
                <td className="mono">{e.code || e.id}</td>
                <td>{e.kind === 'thu' ? <span className="badge badge-ok">Thu</span> : <span className="badge badge-danger">Chi</span>}</td>
                <td><Money value={e.amount} /></td>
                <td>{e.note || '—'}</td>
                <td>{fmtDate(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
