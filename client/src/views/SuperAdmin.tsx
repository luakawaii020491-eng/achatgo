// Super Admin: quản lý shop, gói SaaS, hạn mức, khóa AI từng shop,
// khóa API Muse từng shop, cách ly dữ liệu, đơn đăng ký dùng thử.
import React, { useEffect, useState } from 'react';
import { callAction, copyText, fmtDate, fmtVnd, maskPhone } from '../api';
import type { AppContext } from '../appctx';
import { ConfirmButton, Modal } from '../components';

export default function SuperAdminView({ data, refresh, toast }: AppContext) {
  const shops = data.shops || [];
  const accounts = data.accounts || [];
  const [tab, setTab] = useState<'shops' | 'plans' | 'keys' | 'isolation'>('shops');
  const [shopModal, setShopModal] = useState<any | null>(null);
  const [shopName, setShopName] = useState('');
  const [shopKey, setShopKey] = useState('');
  const [shopPlan, setShopPlan] = useState('dung-thu');
  const [quotas, setQuotas] = useState<Record<string, any>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [claudeList, setClaudeList] = useState<Record<string, any>>({});
  const [globalKey, setGlobalKey] = useState<any>(null);
  const [pasteShop, setPasteShop] = useState('');
  const [pasteKind, setPasteKind] = useState<'ai' | 'claude'>('ai');
  const [pasteKey, setPasteKey] = useState('');
  const [saas, setSaas] = useState<any>(data.saasConfig || {});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      for (const s of shops) {
        try {
          const q: any = await callAction('getshopquota', { shopKey: s.key });
          setQuotas((prev) => ({ ...prev, [s.key]: q }));
        } catch { /* bỏ qua */ }
      }
      try {
        const list: any = await callAction('listclaudeshopkeys', {});
        const map: Record<string, any> = {};
        for (const row of list?.shops || []) map[row.shopKey] = row;
        setClaudeList(map);
        setGlobalKey(list?.global || null);
      } catch { /* bỏ qua */ }
    })();
  }, [shops.length]);

  const reloadKeyList = async () => {
    try {
      const list: any = await callAction('listclaudeshopkeys', {});
      const map: Record<string, any> = {};
      for (const row of list?.shops || []) map[row.shopKey] = row;
      setClaudeList(map);
      setGlobalKey(list?.global || null);
    } catch { /* bỏ qua */ }
  };

  const saveShop = async () => {
    if (!shopName.trim() || !shopKey.trim()) { toast('Nhập tên shop và key (tên miền riêng).'); return; }
    setBusy(true);
    try {
      await callAction('saveshop', {
        ...(shopModal?.key ? { key: shopModal.key } : { key: shopKey.trim().toLowerCase() }),
        name: shopName.trim(),
        plan: shopPlan,
        domain: `${shopKey.trim().toLowerCase()}.achat.vn`,
      });
      toast(`Đã ${shopModal?.key ? 'lưu' : 'tạo'} shop ${shopName.trim()} — shop mới bắt đầu trống hoàn toàn.`);
      setShopModal(null);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu shop thất bại');
    } finally { setBusy(false); }
  };

  const generateKey = async (sk: string, kind: 'ai' | 'claude') => {
    setBusy(true);
    try {
      const r: any = await callAction('generateclaudeapikey', { shopKey: sk, kind });
      setRevealed((prev) => ({ ...prev, [`${kind}-${sk}`]: r?.key || r?.apiKey || '' }));
      toast(`Đã tạo ${kind === 'ai' ? 'khóa AI' : 'khóa API Muse'} mới cho shop ${sk} — chỉ hiện 1 lần, lưu lại ngay.`);
      await reloadKeyList();
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Tạo khóa thất bại');
    } finally { setBusy(false); }
  };

  const generateGlobalKey = async () => {
    setBusy(true);
    try {
      const r: any = await callAction('generateclaudeapikey', { kind: 'claude' });
      setRevealed((prev) => ({ ...prev, 'claude-global': r?.key || r?.apiKey || '' }));
      toast('Đã tạo khóa API Muse toàn cục của Super Admin — chỉ hiện 1 lần, lưu lại ngay.');
      await reloadKeyList();
    } catch (e: any) {
      toast(e.message || 'Tạo khóa toàn cục thất bại');
    } finally { setBusy(false); }
  };

  const revealKey = async (sk: string, kind: 'ai' | 'claude') => {
    try {
      // Khóa chỉ lưu dạng băm nên "Hiện khóa" trả dạng đã che — khóa đầy đủ chỉ
      // hiện đúng 1 lần lúc tạo (khác artifact: artifact lưu được khóa gốc).
      const r: any = await callAction('revealclaudeapikey', { shopKey: sk, kind });
      const masked = r?.masked || '';
      setRevealed((prev) => ({ ...prev, [`${kind}-${sk}`]: masked ? `${masked} (đã che — khóa gốc chỉ hiện 1 lần lúc tạo)` : 'Chưa có khóa.' }));
    } catch (e: any) {
      toast(e.message || 'Hiện khóa thất bại');
    }
  };

  const copyKey = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? 'Đã sao chép.' : 'Không sao chép được — bôi đen rồi Ctrl+C để copy tay.');
  };

  const savePastedKey = async () => {
    if (!pasteShop || !pasteKey.trim()) { toast('Chọn shop và dán khóa.'); return; }
    setBusy(true);
    try {
      await callAction('setshopaikey', { shopKey: pasteShop, kind: pasteKind, apiKey: pasteKey.trim() });
      toast(`Đã lưu ${pasteKind === 'ai' ? 'khóa AI' : 'khóa API Muse'} cho shop ${pasteShop}.`);
      setPasteKey('');
      await reloadKeyList();
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu khóa thất bại');
    } finally { setBusy(false); }
  };

  const saveSaas = async () => {
    try {
      await callAction('savesaasconfig', saas);
      toast('Đã lưu cấu hình SaaS.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Lưu cấu hình thất bại');
    }
  };

  const applyIsolation = async () => {
    try {
      const r: any = await callAction('applypershopdataisolation', {});
      toast(r?.message || 'Đã áp dụng cách ly dữ liệu theo shop.');
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Áp dụng cách ly thất bại');
    }
  };

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'shops' ? 'active' : ''}`} onClick={() => setTab('shops')}>Shop ({shops.length})</button>
        <button className={`tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>Gói &amp; hạn mức</button>
        <button className={`tab ${tab === 'keys' ? 'active' : ''}`} onClick={() => setTab('keys')}>Khóa AI / API Muse</button>
        <button className={`tab ${tab === 'isolation' ? 'active' : ''}`} onClick={() => setTab('isolation')}>Cách ly dữ liệu</button>
      </div>

      {tab === 'shops' && (
        <div>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={() => { setShopModal({}); setShopName(''); setShopKey(''); setShopPlan('dung-thu'); }}>+ Thêm shop</button>
            <span className="muted">Shop mới bắt đầu dữ liệu hoàn toàn mới; dữ liệu cũ (Xinh/Bé Đan/Hana) giữ nguyên, chỉ Super Admin thấy để test — không xóa.</span>
          </div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Shop</th><th>Tên miền riêng</th><th>Gói</th><th>Page / Nhân viên</th><th>Hết hạn dùng thử</th><th></th></tr></thead>
              <tbody>
                {shops.map((s) => {
                  const q = quotas[s.key];
                  return (
                    <tr key={s.key}>
                      <td><b>{s.name}</b><br /><span className="mono small muted">{s.key}</span></td>
                      <td className="mono">{s.domain || `${s.key}.achat.vn`}</td>
                      <td><span className="badge">{s.plan}</span><br /><span className="muted small">{s.status}</span></td>
                      <td>{q ? `${q.pages?.used ?? '—'}/${q.pages?.limit ?? '—'} page • ${q.staff?.used ?? '—'}/${q.staff?.limit ?? '—'} NV` : `${s.pageLimit} / ${s.staffLimit}`}</td>
                      <td>{s.trialEndsAt ? fmtDate(s.trialEndsAt) : '—'}</td>
                      <td className="nowrap">
                        <button className="btn btn-sm" onClick={() => { setShopModal(s); setShopName(s.name); setShopKey(s.key); setShopPlan(s.plan); }}>Sửa</button>{' '}
                        <ConfirmButton label="Xóa" confirmText="Bấm lại để xóa thật" className="btn btn-sm btn-danger"
                          onConfirm={async () => { await callAction('deleteshop', { shopKey: s.key }); toast(`Đã xóa shop ${s.name}.`); await refresh(); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Tài khoản ({accounts.length})</h3>
            <table className="table"><thead><tr><th>Tên</th><th>Email / Username</th><th>Vai trò</th><th>Shop</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}><td>{a.displayName || a.username}</td><td>{a.email}<br /><span className="mono small muted">{a.username}</span></td><td>{a.role}</td><td>{a.shopKey || '—'}</td></tr>
                ))}
              </tbody></table>
          </div>
          {shopModal !== null && (
            <Modal title={shopModal?.key ? `Sửa shop ${shopModal.name}` : 'Thêm shop mới'} onClose={() => setShopModal(null)}>
              <label>Tên shop <input value={shopName} onChange={(e) => setShopName(e.target.value)} /></label>
              <label>Key shop (tên miền riêng sẽ là key.achat.vn) <input value={shopKey} onChange={(e) => setShopKey(e.target.value)} disabled={!!shopModal?.key} placeholder="vd: luaxinh" /></label>
              <label>Gói
                <select value={shopPlan} onChange={(e) => setShopPlan(e.target.value)}>
                  <option value="dung-thu">Dùng thử</option>
                  <option value="co-ban">Cơ bản</option>
                  <option value="nang-cao">Nâng cao</option>
                  <option value="pro">Pro (gói cũ 3 shop gốc)</option>
                </select>
              </label>
              <button className="btn btn-primary" onClick={saveShop} disabled={busy}>Lưu shop</button>
            </Modal>
          )}
        </div>
      )}

      {tab === 'plans' && (
        <div className="card">
          <h3>Gói SaaS &amp; hạn mức</h3>
          <p className="muted small">Cơ bản 199k (5 page / 5 nhân viên), Nâng cao 399k (10 / 10), mua thêm 20.000đ/tháng/page và 20.000đ/tháng/nhân viên — tất cả tùy chỉnh được ở đây. Gói dùng thử mặc định chỉ 1 page + 1 nhân viên.</p>
          <div className="form-grid">
            <label>Giá mua thêm 1 page (đ/tháng) <input type="number" min={0} value={saas.extraPagePrice ?? 20000} onChange={(e) => setSaas({ ...saas, extraPagePrice: Number(e.target.value) || 0 })} /></label>
            <label>Giá mua thêm 1 nhân viên (đ/tháng) <input type="number" min={0} value={saas.extraStaffPrice ?? 20000} onChange={(e) => setSaas({ ...saas, extraStaffPrice: Number(e.target.value) || 0 })} /></label>
            <label>Tổng đài liên hệ <input value={saas.hotline || ''} onChange={(e) => setSaas({ ...saas, hotline: e.target.value })} /></label>
            <label>Tên miền chính <input value={saas.mainDomain || 'achat.vn'} onChange={(e) => setSaas({ ...saas, mainDomain: e.target.value })} /></label>
          </div>
          <h4>Các gói</h4>
          <table className="table"><thead><tr><th>Gói</th><th>Page</th><th>Nhân viên</th><th>Giá/tháng</th></tr></thead>
            <tbody>
              {(saas.plans || []).map((p: any) => (
                <tr key={p.key}><td>{p.name}</td><td>{p.pageLimit}</td><td>{p.staffLimit}</td><td>{p.price ? fmtVnd(p.price) : 'Miễn phí'}</td></tr>
              ))}
            </tbody></table>
          <button className="btn btn-primary" onClick={saveSaas}>Lưu cấu hình SaaS</button>
        </div>
      )}

      {tab === 'keys' && (
        <div className="card">
          <h3>Khóa AI &amp; khóa API Muse theo shop</h3>
          <p className="muted small">Khóa AI và khóa API Muse là 2 khóa khác nhau, mỗi shop 1 cặp riêng. Tạo lại chỉ vô hiệu khóa cũ của đúng shop đó. Khóa chỉ hiện đầy đủ 1 lần khi tạo — lưu lại ngay; lần sau chỉ xem được dạng đã che. Chỉ Super Admin thấy được tab này — tài khoản shop không thấy và không gọi được API tạo/hiện khóa.</p>
          <h4>Khóa API Muse toàn cục (Super Admin)</h4>
          <p className="muted small">
            {globalKey?.hasKey ? <>Đã có khóa toàn cục: <span className="mono">{globalKey.masked}</span> (tạo {globalKey.createdAt ? fmtDate(globalKey.createdAt) : '—'})</> : 'Chưa có khóa toàn cục.'}
            {revealed['claude-global'] && (
              <span> — khóa vừa tạo: <span className="mono" style={{ wordBreak: 'break-all' }}>{revealed['claude-global']}</span> <button className="btn btn-sm" onClick={() => copyKey(revealed['claude-global'])}>Sao chép</button></span>
            )}
          </p>
          <div className="toolbar"><button className="btn" onClick={generateGlobalKey} disabled={busy}>Tạo khóa API Muse toàn cục</button></div>
          <table className="table">
            <thead><tr><th>Shop</th><th>Khóa AI</th><th>Khóa API Muse</th><th></th></tr></thead>
            <tbody>
              {shops.map((s) => {
                const row = claudeList[s.key] || {};
                return (
                <tr key={s.key}>
                  <td><b>{s.name}</b><br /><span className="mono small muted">{s.key}</span></td>
                  <td>
                    {row.hasAiKey ? <span className="badge badge-ok">Đã gán</span> : <span className="badge">Chưa gán</span>}
                    {row.aiMasked && <div className="mono small" style={{ marginTop: 4 }}>{row.aiMasked} <button className="btn btn-sm" onClick={() => copyKey(row.aiMasked)}>Sao chép</button></div>}
                    {revealed[`ai-${s.key}`] && <div className="mono small" style={{ wordBreak: 'break-all', marginTop: 4 }}>{revealed[`ai-${s.key}`]} <button className="btn btn-sm" onClick={() => copyKey(revealed[`ai-${s.key}`])}>Sao chép</button></div>}
                  </td>
                  <td>
                    {row.hasClaudeKey ? <span className="badge badge-ok">Đã gán</span> : <span className="badge">Chưa gán</span>}
                    {row.claudeMasked && <div className="mono small" style={{ marginTop: 4 }}>{row.claudeMasked} <button className="btn btn-sm" onClick={() => copyKey(row.claudeMasked)}>Sao chép</button></div>}
                    {revealed[`claude-${s.key}`] && <div className="mono small" style={{ wordBreak: 'break-all', marginTop: 4 }}>{revealed[`claude-${s.key}`]} <button className="btn btn-sm" onClick={() => copyKey(revealed[`claude-${s.key}`])}>Sao chép</button></div>}
                  </td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => generateKey(s.key, 'ai')} disabled={busy}>Tạo khóa AI mới</button>{' '}
                    <button className="btn btn-sm" onClick={() => revealKey(s.key, 'ai')}>Hiện khóa AI</button>{' '}
                    <button className="btn btn-sm" onClick={() => generateKey(s.key, 'claude')} disabled={busy}>Tạo khóa API Muse</button>{' '}
                    <button className="btn btn-sm" onClick={() => revealKey(s.key, 'claude')}>Hiện khóa API Muse</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <h4>Dán khóa có sẵn cho shop</h4>
          <p className="muted small">Shop đã có khóa từ trước thì dán vào đây thay vì tạo mới.</p>
          <div className="form-grid">
            <label>Shop
              <select value={pasteShop} onChange={(e) => setPasteShop(e.target.value)}>
                <option value="">— Chọn shop —</option>
                {shops.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
              </select>
            </label>
            <label>Loại khóa
              <select value={pasteKind} onChange={(e) => setPasteKind(e.target.value as 'ai' | 'claude')}>
                <option value="ai">Khóa AI</option>
                <option value="claude">Khóa API Muse</option>
              </select>
            </label>
            <label>Khóa <input type="password" value={pasteKey} onChange={(e) => setPasteKey(e.target.value)} placeholder="sk-…" /></label>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" onClick={savePastedKey} disabled={busy}>Lưu khóa</button>
            </div>
          </div>
          <h4>Đơn đăng ký dùng thử chờ duyệt</h4>
          <p className="muted">Đăng ký dùng thử (1 hoặc 7 ngày) vào hàng đợi duyệt ở đây — duyệt xong shop mới vào được app.</p>
          <button className="btn" onClick={async () => { try { await callAction('seedsampleorders', {}); toast('Đã tạo 6 đơn mẫu (ghi rõ “Đơn mẫu — xóa khi không cần”).'); await refresh(); } catch (e: any) { toast(e.message); } }}>Tạo 6 đơn mẫu để test</button>
        </div>
      )}

      {tab === 'isolation' && (
        <div className="card">
          <h3>Cách ly dữ liệu theo shop</h3>
          <p>Shop mới đẩy sang thì dữ liệu mới hoàn toàn; dữ liệu cũ (Xinh/Bé Đan/Hana) GIỮ NGUYÊN, chỉ Super Admin thấy để test — không xóa.</p>
          <p>Trạng thái: {data.dataIsolationApplied ? <span className="badge badge-ok">Đã áp dụng</span> : <span className="badge">Chưa áp dụng</span>}</p>
          <button className="btn btn-primary" onClick={applyIsolation}>Áp dụng cách ly dữ liệu</button>
        </div>
      )}
    </div>
  );
}
