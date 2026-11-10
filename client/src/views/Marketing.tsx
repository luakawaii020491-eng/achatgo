// Marketing: chiến dịch nhắn tin + soạn nội dung bán hàng bằng AI.
import React, { useState } from 'react';
import { callAction, fmtDate, fmtVnd } from '../api';
import type { AppContext } from '../appctx';

export default function MarketingView({ data, shopKey, refresh, toast }: AppContext) {
  const campaigns = data.campaigns || [];
  const [name, setName] = useState('');
  const [genTopic, setGenTopic] = useState('');
  const [genResult, setGenResult] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCampaign = async (c: any) => {
    setBusy(true);
    try {
      const r: any = await callAction('sendcampaign', { campaignId: c.id, shopKey }, shopKey);
      toast(`Đã gửi chiến dịch: ${r?.sent ?? 0} đã gửi, ${r?.failed ?? 0} lỗi.`);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Gửi chiến dịch thất bại');
    } finally { setBusy(false); }
  };

  const generate = async () => {
    if (!genTopic.trim()) return;
    setBusy(true);
    try {
      const r: any = await callAction('aigeneratecontent', { topic: genTopic, shopKey }, shopKey);
      setGenResult(r?.content || r?.draft || JSON.stringify(r, null, 2));
    } catch (e: any) {
      toast(e.message || 'Soạn nội dung thất bại');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card">
        <h3>Chiến dịch nhắn tin</h3>
        <p className="muted small">Gửi qua Messenger thật (Send API) tới khách đã có hội thoại — mỗi người nhận đều có kết quả gửi/thất bại thật.</p>
        <div className="toolbar">
          <input placeholder="Tên chiến dịch mới…" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 260 }} />
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={async () => {
            try {
              await callAction('saverecord', { kind: 'campaign', record: { name: name.trim(), status: 'draft', shopKey } }, shopKey);
              setName('');
              toast('Đã tạo chiến dịch nháp.');
              await refresh();
            } catch (e: any) { toast(e.message); }
          }}>+ Tạo chiến dịch</button>
        </div>
        {campaigns.length === 0 ? <div className="empty">Chưa có chiến dịch nào.</div> : (
          <table className="table">
            <thead><tr><th>Tên</th><th>Trạng thái</th><th>Tạo lúc</th><th></th></tr></thead>
            <tbody>
              {campaigns.map((c: any) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><span className="badge">{c.status}</span></td>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => sendCampaign(c)}>Gửi ngay</button>{' '}
                    <button className="btn btn-sm" disabled={busy} onClick={async () => { await callAction('refreshcampaignstats', { campaignId: c.id }, shopKey); toast('Đã làm mới thống kê.'); await refresh(); }}>Làm mới thống kê</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h3>Soạn nội dung bán hàng (AI)</h3>
        <div className="toolbar">
          <input placeholder="Chủ đề — vd: sale 2 đôi quai ngang 99k miễn ship" value={genTopic} onChange={(e) => setGenTopic(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={generate} disabled={busy}>Soạn bằng AI</button>
        </div>
        {genResult && <pre style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 6 }}>{genResult}</pre>}
      </div>
    </div>
  );
}
