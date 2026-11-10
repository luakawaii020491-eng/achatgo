// Kênh bán hàng: TikTok Shop + Shopee + Facebook Messenger.
// App chung 1 app cho cả nền tảng (Super Admin nhập app 1 lần); shop chỉ bấm kết nối.
import React, { useState } from 'react';
import { callAction, fmtVnd } from '../api';
import type { AppContext } from '../appctx';

function StatusBadge({ s }: { s?: string }) {
  if (s === 'connected') return <span className="badge badge-ok">Đã kết nối</span>;
  if (s === 'expired') return <span className="badge badge-danger">Token hết hạn</span>;
  if (s === 'revoked') return <span className="badge badge-danger">Đã hủy ủy quyền</span>;
  return <span className="badge">Chưa kết nối</span>;
}

export default function ChannelsView({ data, shopKey, isSuperAdmin, refresh, toast, channelFocus }: AppContext) {
  const [busy, setBusy] = useState('');

  React.useEffect(() => {
    if (!channelFocus) return;
    const el = document.getElementById(`channel-${channelFocus}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [channelFocus]);
  const [ttProducts, setTtProducts] = useState<any[] | null>(null);
  const [spProducts, setSpProducts] = useState<any[] | null>(null);
  const [ttCfg, setTtCfg] = useState({ appKey: '', appSecret: '', serviceId: '', redirectUri: '', webhookUrl: '', authorizeHost: '', apiVersion: '202309' });
  const [spCfg, setSpCfg] = useState({ partnerId: '', partnerKey: '', redirectUri: '', webhookUrl: '', apiHost: '', sandbox: false });
  const [cfgLoaded, setCfgLoaded] = useState(false);

  const run = async (key: string, fn: () => Promise<any>, okMsg?: string | ((r: any) => string)) => {
    setBusy(key);
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? (okMsg as any)(r) : okMsg);
      await refresh();
      return r;
    } catch (e: any) {
      toast(e.message || 'Thao tác thất bại');
      return null;
    } finally {
      setBusy('');
    }
  };

  const loadConfigs = async () => {
    if (!isSuperAdmin || cfgLoaded) return;
    setCfgLoaded(true);
    try {
      const t: any = await callAction('gettiktokplatformconfig', {});
      if (t?.platform) setTtCfg((c) => ({ ...c, ...t.platform, appKey: '', appSecret: '' }));
    } catch { /* chưa cấu hình */ }
    try {
      const s: any = await callAction('getshopeeplatformconfig', {});
      if (s?.platform) setSpCfg((c) => ({ ...c, ...s.platform, partnerId: '', partnerKey: '' }));
    } catch { /* chưa cấu hình */ }
  };
  React.useEffect(() => { loadConfigs(); }, []);

  const ttMaps = (data.tiktokSkuMaps || []).filter((m: any) => !shopKey || m.shopKey === shopKey);
  const ttReturns = (data.tiktokReturns || []).filter((r: any) => !shopKey || r.shopKey === shopKey).slice(-5).reverse();
  const ttFinance = (data.tiktokFinance || []).filter((r: any) => !shopKey || r.shopKey === shopKey).slice(-5).reverse();
  const ttEvents = (data.tiktokWebhookEvents || []).filter((e: any) => !shopKey || e.shopKey === shopKey).slice(-5).reverse();
  const spMaps = (data.shopeeSkuMaps || []).filter((m: any) => !shopKey || m.shopKey === shopKey);
  const spReturns = (data.shopeeReturns || []).filter((r: any) => !shopKey || r.shopKey === shopKey).slice(-5).reverse();
  const spFinance = (data.shopeeFinance || []).filter((r: any) => !shopKey || r.shopKey === shopKey).slice(-5).reverse();
  const spEvents = (data.shopeeWebhookEvents || []).filter((e: any) => !shopKey || e.shopKey === shopKey).slice(-5).reverse();

  const [ttMap, setTtMap] = useState({ internalSku: '', productId: '', skuId: '' });
  const [spMap, setSpMap] = useState({ internalSku: '', itemId: '', modelId: '' });

  return (
    <div>
      <div className="card" id="channel-tiktok">
        <h3>TikTok Shop <StatusBadge /></h3>
        <p>App TikTok chung của AChatGo (1 app cho mọi shop). Shop bấm “Kết nối TikTok” rồi ủy quyền tài khoản seller — không tự nhập app. Nhắn tin khách cần quyền Customer Service do TikTok cấp trong Partner Center.</p>
        <div className="toolbar">
          <button className="btn btn-primary" disabled={busy !== ''} onClick={() => run('tt-connect', async () => { const r: any = await callAction('gettiktokoauthurl', {}, shopKey); window.open(r.url, '_blank'); return r; }, 'Đã mở trang ủy quyền TikTok trong tab mới.')}>Kết nối TikTok</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-sync-orders', () => callAction('synctiktokorders', { daysBack: 7 }, shopKey), (r: any) => `Đồng bộ đơn TikTok: ${r.fetched} lấy về, ${r.created} mới, ${r.updated} cập nhật.`)}>Đồng bộ đơn</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-sync-products', () => callAction('synctiktokproducts', {}, shopKey), (r: any) => `Đồng bộ SP: ${r.fetchedProducts} SP, ${r.matched} SKU khớp.`)}>Đồng bộ sản phẩm</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-sync-returns', () => callAction('synctiktokreturns', { daysBack: 30 }, shopKey), (r: any) => `Hoàn/trả: ${r.returns} hoàn + ${r.cancellations} hủy, ${r.created} mới.`)}>Đồng bộ hoàn/trả</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-sync-finance', () => callAction('synctiktokfinance', { daysBack: 30 }, shopKey), (r: any) => `Tài chính: ${r.statements} sao kê, ${r.transactions} giao dịch.`)}>Đồng bộ tài chính</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-poll', () => callAction('tiktokpoll', {}, shopKey), 'Poll xong.')}>Poll ngay</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-refresh', () => callAction('refreshtiktoktoken', {}, shopKey), 'Đã làm mới token TikTok.')}>Làm mới token</button>
          <button className="btn" disabled={busy !== ''} onClick={() => run('tt-webhook', () => callAction('registertiktokwebhook', {}, shopKey), (r: any) => `Webhook: ${r.registered} thành công, ${r.failed} thất bại.`)}>Đăng ký webhook</button>
          <button className="btn btn-danger" disabled={busy !== ''} onClick={() => run('tt-disconnect', () => callAction('disconnecttiktok', {}, shopKey), 'Đã ngắt kết nối TikTok Shop.')}>Ngắt kết nối</button>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="card">
          <h3>App TikTok chung — chỉ Super Admin</h3>
          <p className="muted small">Đăng ký 1 Public app trong TikTok Shop Partner Center, nhập app_key/app_secret/service_id 1 lần duy nhất ở đây. App Secret không bao giờ hiện lại — để trống là giữ nguyên. Đổi App Key/Service ID sẽ xóa token ủy quyền của mọi shop.</p>
          <div className="form-grid">
            <label>App Key <input value={ttCfg.appKey} onChange={(e) => setTtCfg({ ...ttCfg, appKey: e.target.value })} placeholder="Đã lưu — để trống giữ nguyên" /></label>
            <label>App Secret <input type="password" value={ttCfg.appSecret} onChange={(e) => setTtCfg({ ...ttCfg, appSecret: e.target.value })} placeholder="Đã lưu — để trống giữ nguyên" /></label>
            <label>Service ID <input value={ttCfg.serviceId} onChange={(e) => setTtCfg({ ...ttCfg, serviceId: e.target.value })} /></label>
            <label>Redirect URI <input value={ttCfg.redirectUri} onChange={(e) => setTtCfg({ ...ttCfg, redirectUri: e.target.value })} placeholder="https://achat.vn/auth/tiktok/callback" /></label>
            <label>Webhook URL <input value={ttCfg.webhookUrl} onChange={(e) => setTtCfg({ ...ttCfg, webhookUrl: e.target.value })} placeholder="https://achat.vn/webhook/tiktok" /></label>
            <label>API version <input value={ttCfg.apiVersion} onChange={(e) => setTtCfg({ ...ttCfg, apiVersion: e.target.value })} /></label>
          </div>
          <button className="btn btn-primary" onClick={() => run('tt-save', () => callAction('savetiktokplatformconfig', { config: ttCfg }), 'Đã lưu app TikTok chung.')}>Lưu app TikTok chung</button>
        </div>
      )}

      <div className="card">
        <h3>Map SKU — catalogue nội bộ ↔ TikTok</h3>
        {ttMaps.length === 0 ? <div className="empty">Chưa có SKU nào được map.</div> : (
          <table className="table"><thead><tr><th>SKU nội bộ</th><th>SP TikTok</th><th>SKU TikTok</th><th>Tồn TikTok</th><th></th></tr></thead>
            <tbody>{ttMaps.map((m: any) => <tr key={m.id}><td className="mono">{m.internalSku}</td><td>{m.productName}</td><td className="mono">{m.skuId}</td><td>{m.tiktokStock ?? '—'}</td><td><button className="btn btn-sm btn-danger" onClick={() => run('tt-unmap', () => callAction('unmaptiktoksku', { id: m.id }, shopKey), 'Đã gỡ map.')}>Gỡ map</button></td></tr>)}</tbody></table>
        )}
        <div className="form-grid">
          <label>SKU nội bộ <input value={ttMap.internalSku} onChange={(e) => setTtMap({ ...ttMap, internalSku: e.target.value })} placeholder="vd: DQN-DEN-36" /></label>
          <label>Product ID TikTok <input value={ttMap.productId} onChange={(e) => setTtMap({ ...ttMap, productId: e.target.value })} /></label>
          <label>SKU ID TikTok <input value={ttMap.skuId} onChange={(e) => setTtMap({ ...ttMap, skuId: e.target.value })} /></label>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => run('tt-map', () => callAction('maptiktoksku', ttMap, shopKey), 'Đã map SKU.')}>Map SKU</button>
          <button className="btn" onClick={() => run('tt-push-stock', () => callAction('pushtiktokstock', { mode: 'both' }, shopKey), (r: any) => `Đẩy lên TikTok: ${r.pushed} thành công, ${r.failed} thất bại.`)}>Đẩy tồn kho + giá lên TikTok</button>
          <button className="btn" onClick={async () => { const r: any = await run('tt-list', () => callAction('gettiktokproducts', { pageSize: 20 }, shopKey)); if (r) setTtProducts(r.products || []); }}>Xem sản phẩm TikTok</button>
        </div>
        {ttProducts && (
          <table className="table"><thead><tr><th>Sản phẩm</th><th>Trạng thái</th><th>SKU</th><th>Giá</th><th>Tồn</th></tr></thead>
            <tbody>{ttProducts.map((p: any) => (p.skus || []).map((s: any) => <tr key={s.id || s.sellerSku}><td>{p.name}</td><td>{p.status}</td><td className="mono">{s.sellerSku || s.id}</td><td>{s.price != null ? fmtVnd(Number(s.price)) : '—'}</td><td>{s.stock ?? '—'}</td></tr>))}</tbody></table>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Hoàn / trả TikTok gần đây</h3>
          {ttReturns.length === 0 ? <div className="empty">Chưa có hoàn/trả nào từ TikTok.</div> : (
            <table className="table"><thead><tr><th>Mã</th><th>Loại</th><th>Trạng thái</th><th>Đơn app</th><th>Tiền hoàn</th></tr></thead>
              <tbody>{ttReturns.map((r: any) => <tr key={r.platformReturnId}><td className="mono">{r.platformReturnId}</td><td>{r.kind}</td><td>{r.status}</td><td className="mono">{r.orderCode || ''}</td><td>{r.refundAmount != null ? fmtVnd(r.refundAmount) : '—'}</td></tr>)}</tbody></table>
          )}
          <h4>Đối soát tài chính</h4>
          {ttFinance.length === 0 ? <div className="empty">Chưa có sao kê nào từ TikTok.</div> : (
            <table className="table"><thead><tr><th>Loại</th><th>Mã</th><th>Đơn app</th><th>Số tiền</th></tr></thead>
              <tbody>{ttFinance.map((f: any) => <tr key={f.platformId}><td>{f.kind}</td><td className="mono">{f.platformId}</td><td className="mono">{f.orderCode || ''}</td><td>{fmtVnd(f.amount)}</td></tr>)}</tbody></table>
          )}
          <h4>Webhook gần đây</h4>
          {ttEvents.length === 0 ? <div className="empty">Chưa nhận event webhook nào.</div> : (
            <table className="table"><thead><tr><th>Event</th><th>Trạng thái</th><th>Nhận lúc</th></tr></thead>
              <tbody>{ttEvents.map((e: any, i: number) => <tr key={i}><td>{e.eventType}</td><td>{e.status}</td><td>{e.receivedAt || ''}</td></tr>)}</tbody></table>
          )}
        </div>

        <div className="card" id="channel-shopee">
          <h3>Shopee</h3>
          <p>App Shopee chung của AChatGo (1 app ISV cho mọi shop). Nhắn tin khách <b>không hỗ trợ qua app</b> — Shopee đóng Chat API với app mới từ 18/11/2024, trả lời tay trong Seller Center. SĐT/địa chỉ khách mặc định bị Shopee che.</p>
          <div className="toolbar">
            <button className="btn btn-primary" disabled={busy !== ''} onClick={() => run('sp-connect', async () => { const r: any = await callAction('getshopeeoauthurl', {}, shopKey); window.open(r.url, '_blank'); return r; }, 'Đã mở trang ủy quyền Shopee trong tab mới.')}>Kết nối Shopee</button>
            <button className="btn" disabled={busy !== ''} onClick={() => run('sp-sync-orders', () => callAction('syncshopeeorders', { daysBack: 7 }, shopKey), (r: any) => `Đồng bộ đơn Shopee: ${r.fetched} lấy về, ${r.created} mới, ${r.updated} cập nhật.`)}>Đồng bộ đơn</button>
            <button className="btn" disabled={busy !== ''} onClick={() => run('sp-sync-products', () => callAction('syncshopeeproducts', {}, shopKey), (r: any) => `Đồng bộ SP: ${r.fetchedProducts} SP, ${r.matched} SKU khớp.`)}>Đồng bộ sản phẩm</button>
            <button className="btn" disabled={busy !== ''} onClick={() => run('sp-sync-returns', () => callAction('syncshopeereturns', { daysBack: 30 }, shopKey), (r: any) => `Hoàn/trả: ${r.returns} hoàn/trả, ${r.created} mới.`)}>Đồng bộ hoàn/trả</button>
            <button className="btn" disabled={busy !== ''} onClick={() => run('sp-sync-finance', () => callAction('syncshopeefinance', { daysBack: 30 }, shopKey), (r: any) => `Đối soát: ${r.escrows} escrow, ${r.payouts} lần rút.`)}>Đối soát (escrow)</button>
            <button className="btn" disabled={busy !== ''} onClick={() => run('sp-poll', () => callAction('shopeepoll', {}, shopKey), 'Poll xong.')}>Poll ngay</button>
            <button className="btn" disabled={busy !== ''} onClick={() => run('sp-refresh', () => callAction('refreshshopeetoken', {}, shopKey), 'Đã làm mới token Shopee.')}>Làm mới token</button>
            <button className="btn btn-danger" disabled={busy !== ''} onClick={() => run('sp-disconnect', () => callAction('disconnectshopee', {}, shopKey), 'Đã ngắt kết nối Shopee.')}>Ngắt kết nối</button>
          </div>
          <h4>Map SKU — catalogue nội bộ ↔ Shopee</h4>
          {spMaps.length === 0 ? <div className="empty">Chưa có SKU nào được map.</div> : (
            <table className="table"><thead><tr><th>SKU nội bộ</th><th>SP Shopee</th><th>Item / Model</th><th>Tồn</th><th></th></tr></thead>
              <tbody>{spMaps.map((m: any) => <tr key={m.id}><td className="mono">{m.internalSku}</td><td>{m.productName}</td><td className="mono">{m.itemId} / {m.modelId || '—'}</td><td>{m.shopeeStock ?? '—'}</td><td><button className="btn btn-sm btn-danger" onClick={() => run('sp-unmap', () => callAction('unmapshopeesku', { id: m.id }, shopKey), 'Đã gỡ map.')}>Gỡ map</button></td></tr>)}</tbody></table>
          )}
          <div className="form-grid">
            <label>SKU nội bộ <input value={spMap.internalSku} onChange={(e) => setSpMap({ ...spMap, internalSku: e.target.value })} placeholder="vd: DQN-DEN-36" /></label>
            <label>Item ID Shopee <input value={spMap.itemId} onChange={(e) => setSpMap({ ...spMap, itemId: e.target.value })} /></label>
            <label>Model ID Shopee <input value={spMap.modelId} onChange={(e) => setSpMap({ ...spMap, modelId: e.target.value })} /></label>
          </div>
          <div className="toolbar">
            <button className="btn" onClick={() => run('sp-map', () => callAction('mapshopeesku', spMap, shopKey), 'Đã map SKU.')}>Map SKU</button>
            <button className="btn" onClick={() => run('sp-push-stock', () => callAction('pushshopeestock', { mode: 'both' }, shopKey), (r: any) => `Đẩy lên Shopee: ${r.pushed} thành công, ${r.failed} thất bại.`)}>Đẩy tồn kho + giá lên Shopee</button>
            <button className="btn" onClick={async () => { const r: any = await run('sp-list', () => callAction('getshopeeproducts', { pageSize: 20 }, shopKey)); if (r) setSpProducts(r.products || []); }}>Xem sản phẩm Shopee</button>
          </div>
          {spProducts && (
            <table className="table"><thead><tr><th>Sản phẩm</th><th>Trạng thái</th><th>SKU</th><th>Giá</th><th>Tồn</th></tr></thead>
              <tbody>{spProducts.map((p: any) => (p.skus || []).map((s: any) => <tr key={s.id || s.modelSku}><td>{p.name}</td><td>{p.status}</td><td className="mono">{s.modelSku || s.id}</td><td>{s.price != null ? fmtVnd(Number(s.price)) : '—'}</td><td>{s.stock ?? '—'}</td></tr>))}</tbody></table>
          )}
          <h4>Hoàn / trả Shopee gần đây</h4>
          {spReturns.length === 0 ? <div className="empty">Chưa có hoàn/trả nào từ Shopee.</div> : (
            <table className="table"><thead><tr><th>Mã</th><th>Loại</th><th>Trạng thái</th><th>Đơn app</th><th>Tiền hoàn</th></tr></thead>
              <tbody>{spReturns.map((r: any) => <tr key={r.platformReturnId}><td className="mono">{r.platformReturnId}</td><td>{r.kind}</td><td>{r.status}</td><td className="mono">{r.orderCode || ''}</td><td>{r.refundAmount != null ? fmtVnd(r.refundAmount) : '—'}</td></tr>)}</tbody></table>
          )}
          <h4>Đối soát tài chính (escrow)</h4>
          {spFinance.length === 0 ? <div className="empty">Chưa có sao kê nào từ Shopee.</div> : (
            <table className="table"><thead><tr><th>Loại</th><th>Mã</th><th>Đơn app</th><th>Số tiền</th></tr></thead>
              <tbody>{spFinance.map((f: any) => <tr key={f.platformId}><td>{f.kind}</td><td className="mono">{f.platformId}</td><td className="mono">{f.orderCode || ''}</td><td>{fmtVnd(f.amount)}</td></tr>)}</tbody></table>
          )}
          <h4>Push webhook gần đây</h4>
          {spEvents.length === 0 ? <div className="empty">Chưa nhận event push nào.</div> : (
            <table className="table"><thead><tr><th>Event</th><th>Trạng thái</th><th>Nhận lúc</th></tr></thead>
              <tbody>{spEvents.map((e: any, i: number) => <tr key={i}><td>{e.eventType}</td><td>{e.status}</td><td>{e.receivedAt || ''}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>

      {isSuperAdmin && (
        <div className="card">
          <h3>App Shopee chung — chỉ Super Admin</h3>
          <p className="muted small">1 app ISV duy nhất cho cả nền tảng AChatGo (đăng ký tại open.shopee.com, cần giấy tờ doanh nghiệp, duyệt ~10 ngày). Partner Key không bao giờ hiện lại — để trống là giữ nguyên. Partner Key hết hạn sau 180 ngày — reset key trong console rồi nhập key mới vào đây.</p>
          <div className="form-grid">
            <label>Partner ID <input value={spCfg.partnerId} onChange={(e) => setSpCfg({ ...spCfg, partnerId: e.target.value })} placeholder="Đã lưu — để trống giữ nguyên" /></label>
            <label>Partner Key <input type="password" value={spCfg.partnerKey} onChange={(e) => setSpCfg({ ...spCfg, partnerKey: e.target.value })} placeholder="Đã lưu — để trống giữ nguyên" /></label>
            <label>Redirect URI <input value={spCfg.redirectUri} onChange={(e) => setSpCfg({ ...spCfg, redirectUri: e.target.value })} placeholder="https://achat.vn/auth/shopee/callback" /></label>
            <label>Webhook URL <input value={spCfg.webhookUrl} onChange={(e) => setSpCfg({ ...spCfg, webhookUrl: e.target.value })} placeholder="https://achat.vn/webhook/shopee" /></label>
            <label>API host <input value={spCfg.apiHost} onChange={(e) => setSpCfg({ ...spCfg, apiHost: e.target.value })} placeholder="https://partner.shopeemobile.com" /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Dùng sandbox <input type="checkbox" checked={spCfg.sandbox} onChange={(e) => setSpCfg({ ...spCfg, sandbox: e.target.checked })} style={{ width: 'auto' }} /></label>
          </div>
          <button className="btn btn-primary" onClick={() => run('sp-save', () => callAction('saveshopeeplatformconfig', { config: spCfg }), 'Đã lưu app Shopee chung.')}>Lưu app Shopee chung</button>
        </div>
      )}

      <div className="card" id="channel-facebook">
        <h3>Facebook Messenger</h3>
        <p>Quản lý ở màn Cài đặt → Kết nối Meta (đăng nhập Facebook, chọn Page + Instagram đã liên kết, gán shop). {(data.fanpages || []).length} page đã nối cho shop này.</p>
        <div className="toolbar">
          <button className="btn" onClick={async () => { try { const r: any = await callAction('getoauthurl', {}, shopKey); window.open(r.url, '_blank'); } catch (e: any) { toast(e.message); } }}>Kết nối Facebook</button>
          <button className="btn" onClick={async () => { try { await callAction('synccomments', {}, shopKey); toast('Đã quét bình luận mới.'); await refresh(); } catch (e: any) { toast(e.message); } }}>Quét bình luận</button>
        </div>
      </div>
    </div>
  );
}
