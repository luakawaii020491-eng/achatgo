// Cài đặt: kết nối Meta, Conversions API (Pixel), hãng vận chuyển,
// kịch bản bình luận, mời vào inbox.
import React, { useEffect, useState } from 'react';
import { callAction } from '../api';
import type { AppContext } from '../appctx';

export default function SettingsView({ data, shopKey, isSuperAdmin, refresh, toast }: AppContext) {
  const [tab, setTab] = useState<'meta' | 'capi' | 'carriers' | 'comments'>('meta');
  const [meta, setMeta] = useState({ appId: '', redirectUri: '' });
  const [capi, setCapi] = useState<any>({ pixelId: '', connected: false, testEventCode: '' });
  const [capiToken, setCapiToken] = useState('');
  const [invite, setInvite] = useState<any>({ enabled: true, defaultMessage: '', publicReplyFallback: true, publicReplyMessage: '' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    setMeta({ appId: data.metaConfig?.appId || '', redirectUri: data.metaConfig?.redirectUri || '' });
    const cfg = (data.capiConfigByShop || {})[shopKey];
    if (cfg) setCapi({ pixelId: cfg.pixelId || '', connected: !!cfg.connected, testEventCode: cfg.testEventCode || '' });
    (async () => {
      try {
        const r: any = await callAction('getinvitesettings', {}, shopKey);
        if (r) setInvite({ enabled: r.enabled !== false, defaultMessage: r.defaultMessage || '', publicReplyFallback: !!r.publicReplyFallback, publicReplyMessage: r.publicReplyMessage || '' });
      } catch { /* mặc định */ }
      try {
        const c: any = await callAction('getcapiconfig', { shopKey }, shopKey);
        if (c) setCapi({ pixelId: c.pixelId || '', connected: !!c.connected, testEventCode: c.testEventCode || '' });
      } catch { /* chưa có */ }
    })();
  }, [loaded, data, shopKey]);

  const carriers = data.carriers || [];
  const scripts = data.commentScripts || [];

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'meta' ? 'active' : ''}`} onClick={() => setTab('meta')}>Kết nối Meta</button>
        <button className={`tab ${tab === 'capi' ? 'active' : ''}`} onClick={() => setTab('capi')}>Pixel / Conversions API</button>
        <button className={`tab ${tab === 'carriers' ? 'active' : ''}`} onClick={() => setTab('carriers')}>Hãng vận chuyển</button>
        <button className={`tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}>Bình luận</button>
      </div>

      {tab === 'meta' && (
        <div className="card">
          <h3>Kết nối Meta (Facebook + Instagram)</h3>
          <p>Đăng nhập Facebook, chọn Page + Instagram đã liên kết, gán shop ngay tại đó. Dán token tay vẫn giữ làm dự phòng. Cần đủ quyền (kể cả pages_read_engagement) thì đồng bộ bình luận mới chạy.</p>
          <div className="form-grid">
            <label>Meta App ID <input value={meta.appId} onChange={(e) => setMeta({ ...meta, appId: e.target.value })} /></label>
            <label>Redirect URI (đã đăng ký trong Meta App) <input value={meta.redirectUri} onChange={(e) => setMeta({ ...meta, redirectUri: e.target.value })} /></label>
          </div>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={async () => { try { await callAction('savemetaconfig', meta, shopKey); toast('Đã lưu cấu hình Meta.'); } catch (e: any) { toast(e.message); } }}>Lưu cấu hình Meta</button>
            <button className="btn" onClick={async () => { try { const r: any = await callAction('getoauthurl', {}, shopKey); window.open(r.url, '_blank'); } catch (e: any) { toast(e.message); } }}>Kết nối Facebook</button>
            <button className="btn" onClick={async () => {
              const token = window.prompt('Dán Page Access Token:');
              if (!token) return;
              try { const r: any = await callAction('connectpagewithtoken', { token, shopKey }, shopKey); toast(`Đã kết nối page ${r?.pageName || r?.pageId || ''}.`); await refresh(); } catch (e: any) { toast(e.message); }
            }}>Dán token tay</button>
          </div>
          <h4>Page đã nối ({(data.fanpages || []).length})</h4>
          {(data.fanpages || []).length === 0 ? <p className="muted">Chưa nối page nào.</p> : (
            <table className="table"><thead><tr><th>Page</th><th>Page ID</th><th>Kết nối</th><th></th></tr></thead>
              <tbody>{(data.fanpages || []).map((f: any) => (
                <tr key={f.id}><td>{f.name}</td><td className="mono">{f.pageId}</td><td>{f.connected ? 'Đã kết nối' : 'Chưa kết nối'}</td>
                  <td><button className="btn btn-sm btn-danger" onClick={async () => { await callAction('disconnectfanpage', { fanpageId: f.id, pageId: f.pageId }, shopKey); toast('Đã ngắt kết nối page.'); await refresh(); }}>Ngắt kết nối</button></td></tr>
              ))}</tbody></table>
          )}
        </div>
      )}

      {tab === 'capi' && (
        <div className="card">
          <h3>Meta Conversions API — báo đơn về Facebook để tính chi phí quảng cáo</h3>
          <p>Khi chốt đơn trên app, app báo về Facebook sự kiện Purchase (SĐT đã băm + mã đơn + tổng COD) để Ads Manager ghi nhận chi phí/mua hàng, ROAS.</p>
          <div className="form-grid">
            <label>Pixel ID <input value={capi.pixelId} onChange={(e) => setCapi({ ...capi, pixelId: e.target.value })} /></label>
            <label>Access token CAPI <input type="password" value={capiToken} onChange={(e) => setCapiToken(e.target.value)} placeholder="Để trống giữ nguyên token đã lưu" /></label>
            <label>Test event code <input value={capi.testEventCode} onChange={(e) => setCapi({ ...capi, testEventCode: e.target.value })} placeholder="Chỉ dùng khi test" /></label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Bật tự gửi Purchase khi tạo đơn
            <input type="checkbox" checked={capi.connected} onChange={(e) => setCapi({ ...capi, connected: e.target.checked })} style={{ width: 'auto' }} />
          </label>
          <div className="toolbar">
            <button className="btn btn-primary" onClick={async () => { try { await callAction('savecapiconfig', { shopKey, pixelId: capi.pixelId, connected: capi.connected, testEventCode: capi.testEventCode, ...(capiToken ? { accessToken: capiToken } : {}) }, shopKey); toast('Đã lưu cấu hình CAPI.'); setCapiToken(''); } catch (e: any) { toast(e.message); } }}>Lưu cấu hình CAPI</button>
            <button className="btn" onClick={async () => { try { const r: any = await callAction('sendcapitestevent', { shopKey, testEventCode: capi.testEventCode || 'TEST123' }, shopKey); toast(`Đã gửi test event: ${r?.status || 'ok'}`); } catch (e: any) { toast(e.message); } }}>Gửi test event</button>
            <button className="btn" onClick={async () => { try { const r: any = await callAction('listshopmetapixels', { shopKey }, shopKey); toast(`Tìm thấy ${r?.pixels?.length || 0} Pixel từ tài khoản Facebook của shop — chọn 1 Pixel để dùng.`); } catch (e: any) { toast(e.message || 'Cần đăng nhập lại Facebook với quyền ads_management/ads_read.'); } }}>Kết nối Facebook để lấy Pixel</button>
          </div>
        </div>
      )}

      {tab === 'carriers' && (
        <div className="card">
          <h3>Hãng vận chuyển</h3>
          <p>GHN, GHTK, Viettel Post, Best đã nối thật. J&T chưa nối thật (đang chờ duyệt developer) — không cấu hình đẩy J&T ở đây.</p>
          {carriers.length === 0 ? <p className="muted">Chưa có cấu hình hãng nào.</p> : (
            <table className="table"><thead><tr><th>Hãng</th><th>Kết nối</th><th></th></tr></thead>
              <tbody>{carriers.map((c: any) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.connected ? <span className="badge badge-ok">Đã kết nối</span> : <span className="badge">Chưa kết nối</span>}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={async () => { try { const r: any = await callAction('testcarrierconnection', { carrier: c.id }, shopKey); toast(`Kiểm tra ${c.name}: ${r?.message || r?.status || 'ok'}`); } catch (e: any) { toast(e.message); } }}>Kiểm tra kết nối</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={async () => { await callAction('disconnectcarrier', { carrier: c.id }, shopKey); toast(`Đã ngắt ${c.name}.`); await refresh(); }}>Ngắt kết nối</button>
                  </td>
                </tr>
              ))}</tbody></table>
          )}
          <h4>Lưu cấu hình hãng mới</h4>
          <CarrierForm shopKey={shopKey} toast={toast} refresh={refresh} />
        </div>
      )}

      {tab === 'comments' && (
        <div className="card">
          <h3>Kịch bản bình luận tự động (theo từng page)</h3>
          <p>Chọn page, đặt tên kịch bản, giờ Làm việc/Vắng mặt, áp dụng cho mọi bình luận mới hoặc chứa từ khóa, soạn tin mời vào inbox (kèm được hình ảnh), trả lời ngay hoặc sau 1–3 phút.</p>
          {scripts.length === 0 ? <p className="muted">Chưa có kịch bản nào — lưu kịch bản mới ở dưới.</p> : (
            <table className="table"><thead><tr><th>Tên</th><th>Page</th><th>Hoạt động</th></tr></thead>
              <tbody>{scripts.map((s: any) => <tr key={s.id}><td>{s.name}</td><td>{s.pageId || s.fanpageId || ''}</td><td>{s.active ? '✓' : '✕'}</td></tr>)}</tbody></table>
          )}
          <CommentScriptForm shopKey={shopKey} fanpages={data.fanpages || []} toast={toast} refresh={refresh} />
          <h4>Cài đặt mời vào inbox (chung)</h4>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Bật mời bình luận vào inbox
            <input type="checkbox" checked={invite.enabled} onChange={(e) => setInvite({ ...invite, enabled: e.target.checked })} style={{ width: 'auto' }} />
          </label>
          <label>Tin mời mặc định
            <textarea rows={2} value={invite.defaultMessage} onChange={(e) => setInvite({ ...invite, defaultMessage: e.target.value })} placeholder="Dạ chị ơi, em nhắn tin riêng cho chị để tư vấn kỹ hơn nha!" />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Trả lời công khai khi Facebook chặn nhắn riêng
            <input type="checkbox" checked={invite.publicReplyFallback} onChange={(e) => setInvite({ ...invite, publicReplyFallback: e.target.checked })} style={{ width: 'auto' }} />
          </label>
          <label>Tin trả lời công khai
            <textarea rows={2} value={invite.publicReplyMessage} onChange={(e) => setInvite({ ...invite, publicReplyMessage: e.target.value })} />
          </label>
          <button className="btn btn-primary" onClick={async () => { try { await callAction('saveinvitesettings', invite, shopKey); toast('Đã lưu cài đặt mời vào inbox.'); } catch (e: any) { toast(e.message); } }}>Lưu cài đặt mời</button>
        </div>
      )}
    </div>
  );
}

function CarrierForm({ shopKey, toast, refresh }: { shopKey: string; toast: (m: string) => void; refresh: () => Promise<void> }) {
  const [carrier, setCarrier] = useState('GHN');
  const [apiKey, setApiKey] = useState('');
  const [extra, setExtra] = useState('');
  return (
    <div className="form-grid">
      <label>Hãng
        <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
          <option>GHN</option><option>GHTK</option><option>Viettel Post</option><option>Best</option>
        </select>
      </label>
      <label>API key / Token <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></label>
      <label>Thông tin thêm (ShopId / username…) <input value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <button className="btn btn-primary" onClick={async () => {
          try { await callAction('savecarrierconfig', { carrier, apiKey, extra, shopKey }, shopKey); toast(`Đã lưu cấu hình ${carrier}.`); setApiKey(''); setExtra(''); await refresh(); } catch (e: any) { toast(e.message); }
        }}>Lưu hãng</button>
      </div>
    </div>
  );
}

function CommentScriptForm({ shopKey, fanpages, toast, refresh }: { shopKey: string; fanpages: any[]; toast: (m: string) => void; refresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [pageId, setPageId] = useState('');
  const [inviteText, setInviteText] = useState('');
  const [delay, setDelay] = useState(1);
  return (
    <div className="form-grid" style={{ marginTop: 12 }}>
      <label>Tên kịch bản <input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Kịch bản HOT DEAL" /></label>
      <label>Page
        <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
          <option value="">— Chọn page —</option>
          {fanpages.map((f: any) => <option key={f.id} value={f.pageId}>{f.name}</option>)}
        </select>
      </label>
      <label>Trả lời sau (phút, 0–3) <input type="number" min={0} max={3} value={delay} onChange={(e) => setDelay(Number(e.target.value) || 0)} /></label>
      <label>Tin mời vào inbox <input value={inviteText} onChange={(e) => setInviteText(e.target.value)} placeholder="Dạ chị ơi, em nhắn tin riêng cho chị để tư vấn kỹ hơn nha!" /></label>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <button className="btn btn-primary" onClick={async () => {
          if (!name.trim() || !pageId) { toast('Nhập tên kịch bản và chọn page.'); return; }
          try { await callAction('savecommentscript', { name: name.trim(), pageId, inviteText, delayMinutes: delay, active: true, shopKey }, shopKey); toast('Đã lưu kịch bản bình luận.'); setName(''); setInviteText(''); await refresh(); } catch (e: any) { toast(e.message); }
        }}>Lưu kịch bản</button>
      </div>
    </div>
  );
}
