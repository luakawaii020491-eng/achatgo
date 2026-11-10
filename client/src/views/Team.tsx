// Nhân viên: tài khoản staff của shop + ma trận quyền theo module.
import React, { useState } from 'react';
import { callAction } from '../api';
import type { AppContext } from '../appctx';
import { ConfirmButton, Modal } from '../components';

const MODULES = ['orders', 'chat', 'products', 'shipping', 'customers', 'finance', 'marketing', 'settings'];
const MODULE_LABELS: Record<string, string> = {
  orders: 'Đơn hàng', chat: 'Hội thoại', products: 'Sản phẩm', shipping: 'Vận chuyển',
  customers: 'Khách hàng', finance: 'Tài chính', marketing: 'Marketing', settings: 'Cài đặt',
};
const ACTIONS = ['view', 'create', 'edit', 'delete'];
const ACTION_LABELS: Record<string, string> = { view: 'Xem', create: 'Tạo', edit: 'Sửa', delete: 'Xóa' };

export default function TeamView({ data, shopKey, refresh, toast, isSuperAdmin }: AppContext) {
  const accounts = (data.accounts || []).filter((a) => a.role !== 'super_admin');
  const [modal, setModal] = useState<any | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [perms, setPerms] = useState<Record<string, string[]>>({});

  const openNew = () => {
    setModal({});
    setEmail(''); setUsername(''); setPassword(''); setDisplayName('');
    setPerms({ orders: ['view', 'create', 'edit'], chat: ['view', 'create'] });
  };

  const togglePerm = (mod: string, act: string) => {
    setPerms((prev) => {
      const cur = prev[mod] || [];
      const next = cur.includes(act) ? cur.filter((a) => a !== act) : [...cur, act];
      return { ...prev, [mod]: next };
    });
  };

  const save = async () => {
    if (!email.trim() || !username.trim() || !password) { toast('Nhập email, tên đăng nhập và mật khẩu.'); return; }
    try {
      await callAction('createshopaccount', {
        email: email.trim(), username: username.trim().toLowerCase(), password,
        displayName: displayName.trim() || username.trim(), role: 'staff',
        shopKey, staffPermissions: perms,
      }, shopKey);
      toast(`Đã tạo tài khoản nhân viên ${username.trim().toLowerCase()}.`);
      setModal(null);
      await refresh();
    } catch (e: any) {
      toast(e.message || 'Tạo tài khoản thất bại');
    }
  };

  const quota = data.saasConfig;
  return (
    <div>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={openNew}>+ Thêm nhân viên</button>
        <span className="muted">Giới hạn nhân viên theo gói — xem hạn mức ở Super Admin → Hạn mức shop.</span>
      </div>
      {accounts.length === 0 ? <div className="empty">Shop chưa có nhân viên nào.</div> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Tên</th><th>Email / Tên đăng nhập</th><th>Vai trò</th><th>Quyền</th><th></th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName || a.username}</td>
                  <td>{a.email}<br /><span className="mono small muted">{a.username}</span></td>
                  <td><span className="badge">{a.role === 'shop_owner' ? 'Chủ shop' : 'Nhân viên'}</span></td>
                  <td className="small">{a.staffPermissions ? Object.entries(a.staffPermissions).map(([m, acts]) => `${MODULE_LABELS[m] || m}: ${(acts as string[]).map((x) => ACTION_LABELS[x] || x).join('+')}`).join(' • ') : 'Toàn quyền trong shop'}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={async () => {
                      const next = window.prompt('Đặt lại mật khẩu mới cho tài khoản này:', '');
                      if (!next) return;
                      await callAction('updateshopaccount', { accountId: a.id, password: next }, shopKey);
                      toast('Đã đặt lại mật khẩu.');
                    }}>Đặt lại MK</button>{' '}
                    <ConfirmButton
                      label="Xóa" confirmText="Bấm lại để xóa thật" className="btn btn-sm btn-danger"
                      onConfirm={async () => { await callAction('deleteshopaccount', { accountId: a.id }, shopKey); toast('Đã xóa tài khoản.'); await refresh(); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal !== null && (
        <Modal title="Thêm nhân viên" onClose={() => setModal(null)} wide>
          <div className="form-grid">
            <label>Tên hiển thị <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
            <label>Email <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vd: nv@shop.vn" /></label>
            <label>Tên đăng nhập (chữ thường) <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="vd: nhanvien1" /></label>
            <label>Mật khẩu (tối thiểu 6 ký tự) <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </div>
          <h4>Ma trận quyền</h4>
          <table className="table">
            <thead><tr><th>Module</th>{ACTIONS.map((a) => <th key={a}>{ACTION_LABELS[a]}</th>)}</tr></thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m}>
                  <td>{MODULE_LABELS[m]}</td>
                  {ACTIONS.map((a) => (
                    <td key={a}>
                      <input type="checkbox" checked={(perms[m] || []).includes(a)} onChange={() => togglePerm(m, a)} style={{ width: 'auto' }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-primary" onClick={save}>Tạo tài khoản</button>
        </Modal>
      )}
    </div>
  );
}
