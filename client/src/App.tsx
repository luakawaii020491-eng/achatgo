// AChatGo — khung app (khớp bản artifact): sidebar navy, header có chọn shop +
// pill trạng thái + nút Tạo đơn, 21 mục sidebar + Tạo đơn (F1): popup dựa
// phải kiểu Sapo khi mở từ màn Hội thoại, toàn màn hình khi mở từ màn khác.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, Boxes, ChevronDown, ChevronLeft, ChevronRight, Crown, LayoutDashboard,
  Megaphone, MessageSquare, MessagesSquare, Package, Radio, RotateCcw, Settings,
  Settings2, ShieldCheck, ShoppingBag, Sparkles, Star, Store, TicketPercent,
  Truck, Users, Wallet,
} from 'lucide-react';
import { callAction, getToken, loadBootstrap, login, logout, setToken } from './api';
import type { AppContext, CreateOrderPrefill } from './appctx';
import type { Account, BootstrapData, Conversation } from './types';
import CreateOrderView from './views/CreateOrder';
import OverviewView from './views/Overview';
import OrdersView from './views/Orders';
import ProductsView from './views/Products';
import CustomersView from './views/Customers';
import SocialChatView from './views/SocialChat';
import CommentsView from './views/Comments';
import LivestreamView from './views/Livestream';
import MarketingView from './views/Marketing';
import PromotionsView from './views/Promotions';
import CashbookView from './views/Cashbook';
import ReturnsView from './views/Returns';
import StockView from './views/Stock';
import ReportsView from './views/Reports';
import ChannelsView from './views/Channels';
import ShippingView from './views/Shipping';
import ShipFeesView from './views/ShipFees';
import AIView from './views/AI';
import ReviewsView from './views/Reviews';
import SettingsView from './views/Settings';
import TeamView from './views/Team';
import SuperAdminView from './views/SuperAdmin';

type ViewKey =
  | 'overview' | 'orders' | 'products' | 'customers' | 'conversations' | 'comments'
  | 'livestream' | 'marketing' | 'promotions' | 'cashbook' | 'returns' | 'stock'
  | 'reports' | 'channels' | 'shipping' | 'shipfees' | 'ai' | 'reviews'
  | 'settings' | 'team' | 'superadmin';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  superOnly?: boolean;
  flyout?: { key: string; label: string }[];
}

const VIEW_TITLES: Record<ViewKey, string> = {
  overview: 'Tổng quan', orders: 'Đơn hàng', products: 'Sản phẩm', customers: 'Khách hàng',
  conversations: 'Hội thoại', comments: 'Bình luận', livestream: 'Livestream',
  marketing: 'Marketing', promotions: 'Khuyến mãi', cashbook: 'Sổ quỹ', returns: 'Trả hàng',
  stock: 'Kho hàng', reports: 'Báo cáo', channels: 'Kênh bán hàng', shipping: 'Vận chuyển',
  shipfees: 'Cài đặt phí ship', ai: 'Trợ lý AI', reviews: 'Đánh giá', settings: 'Cài đặt',
  team: 'Nhân viên', superadmin: 'Super Admin',
};

/** Lọc dữ liệu bootstrap theo shop đã chọn (Super Admin xem tất cả khi rỗng).
 * Lọc NGHIÊM NGẶT theo shopKey: record không có shopKey KHÔNG tự thuộc về mọi
 * shop (v44: page/quy tắc của Super Admin rò sang shop khác qua nhánh !x.shopKey). */
function scopeData(data: BootstrapData, shopKey: string): BootstrapData {
  if (!shopKey) return data;
  const byShop = (arr: any[] | undefined) => (arr || []).filter((x) => x.shopKey === shopKey);
  return {
    ...data,
    orders: byShop(data.orders),
    products: (data.products || []).filter((p) => p.shopKey === shopKey || p.shopKey === 'shared'),
    customers: byShop(data.customers),
    conversations: byShop(data.conversations),
    fanpages: byShop(data.fanpages),
    coupons: byShop(data.coupons),
    campaigns: byShop(data.campaigns),
    cashEntries: byShop(data.cashEntries),
    aiRules: byShop(data.aiRules),
    shipFeeRulesByShop: { [shopKey]: (data.shipFeeRulesByShop || {})[shopKey] || [] },
    capiConfigByShop: { [shopKey]: (data.capiConfigByShop || {})[shopKey] },
    quickReplies: byShop(data.quickReplies),
    comments: byShop(data.comments),
    liveSessions: byShop(data.liveSessions),
    returnSlips: byShop(data.returnSlips),
    stockRecords: byShop(data.stockRecords),
    supplierDebts: byShop(data.supplierDebts),
    tiktokSkuMaps: byShop(data.tiktokSkuMaps),
    tiktokFinance: byShop(data.tiktokFinance),
    tiktokReturns: byShop(data.tiktokReturns),
    tiktokWebhookEvents: byShop(data.tiktokWebhookEvents),
    shopeeSkuMaps: byShop(data.shopeeSkuMaps),
    shopeeFinance: byShop(data.shopeeFinance),
    shopeeReturns: byShop(data.shopeeReturns),
    shopeeWebhookEvents: byShop(data.shopeeWebhookEvents),
    aiKnowledge: byShop(data.aiKnowledge),
    records: data.records ? Object.fromEntries(Object.entries(data.records).map(([k, v]) => [k, byShop(v as any[])])) : data.records,
  };
}

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<ViewKey>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [channelFocus, setChannelFocus] = useState<string | null>(null);
  const [selectedShop, setSelectedShop] = useState('');
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<CreateOrderPrefill | undefined>(undefined);
  const [createConversation, setCreateConversation] = useState<Conversation | undefined>(undefined);
  // Mép trái cửa sổ Tạo đơn khi mở dạng popup dựa phải (kiểu Sapo) từ màn
  // Hội thoại — đo thật từ mép phải cột chat; null = toàn màn hình như cũ.
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const [orderWinLeft, setOrderWinLeft] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [flyout, setFlyout] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 4500);
  }, []);

  const refresh = useCallback(async () => {
    const d = await loadBootstrap();
    setData(d);
  }, []);

  useEffect(() => {
    (async () => {
      if (!getToken()) { setLoading(false); return; }
      try {
        const d = await loadBootstrap();
        setData(d);
        // Tài khoản lấy từ bootstrap._meta? Không — lấy lại từ token không được;
        // dùng tài khoản đã lưu local.
        const saved = localStorage.getItem('achatgo_account');
        if (saved) setAccount(JSON.parse(saved));
        else {
          // Fallback: tài khoản đầu tiên khớp token (id = token).
          const acc = (d.accounts || []).find((a) => a.id === getToken());
          if (acc) setAccount(acc);
        }
      } catch {
        setToken('');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Shop mặc định: shop của tài khoản; Super Admin xem tất cả.
  useEffect(() => {
    if (account && !selectedShop) {
      setSelectedShop(account.shopKey || '');
    }
  }, [account]);

  const isSuperAdmin = account?.role === 'super_admin';
  const scoped = useMemo(() => (data ? scopeData(data, isSuperAdmin ? selectedShop : account?.shopKey || '') : null), [data, selectedShop, isSuperAdmin, account]);
  const shopKey = isSuperAdmin ? selectedShop : account?.shopKey || '';

  const openCreateOrder = useCallback((prefill?: CreateOrderPrefill, conv?: Conversation) => {
    setCreatePrefill(prefill);
    setCreateConversation(conv);
    setCreateOrderOpen(true);
  }, []);

  // Đo mép trái cửa sổ Tạo đơn từ mép phải cột chat (SocialChatView gắn
  // chatThreadRef vào .chat-thread). Chỉ dock khi đang ở màn Hội thoại và
  // màn hình >= lg (1024px); màn nhỏ / màn khác vẫn toàn màn hình như cũ.
  const measureOrderWin = useCallback(() => {
    if (!createOrderOpen || view !== 'conversations' || window.innerWidth < 1024) {
      setOrderWinLeft((prev) => (prev === null ? prev : null));
      return;
    }
    const el = chatThreadRef.current;
    if (!el) {
      setOrderWinLeft((prev) => (prev === null ? prev : null));
      return;
    }
    const left = Math.round(el.getBoundingClientRect().right);
    setOrderWinLeft((prev) => (prev === left ? prev : left));
  }, [createOrderOpen, view]);

  // Layout effect + resize listener: đo lại khi mở/đóng cửa sổ, đổi màn,
  // thu/mở sidebar (đổi vị trí cột chat).
  useLayoutEffect(() => {
    measureOrderWin();
    window.addEventListener('resize', measureOrderWin);
    return () => window.removeEventListener('resize', measureOrderWin);
  }, [measureOrderWin, collapsed]);

  const ctx: AppContext | null = useMemo(() => {
    if (!scoped || !account) return null;
    return {
      data: scoped, account, shopKey, isSuperAdmin,
      refresh, toast, openCreateOrder,
      channelFocus,
    } as AppContext;
  }, [scoped, account, shopKey, isSuperAdmin, refresh, toast, openCreateOrder, channelFocus]);

  // F1 mở Tạo đơn (toàn app, khi đã đăng nhập).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1' && account && !createOrderOpen) {
        e.preventDefault();
        openCreateOrder();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [account, createOrderOpen, openCreateOrder]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const { account: acc } = await login(identifier.trim(), password);
      setAccount(acc);
      localStorage.setItem('achatgo_account', JSON.stringify(acc));
      const d = await loadBootstrap();
      setData(d);
      if (acc.mustChangePassword) {
        toast('Tài khoản này dùng mật khẩu tạm — hãy đổi mật khẩu ngay ở menu tài khoản (góc dưới sidebar).');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Đăng nhập thất bại');
    }
  };

  const doLogout = async () => {
    await logout();
    localStorage.removeItem('achatgo_account');
    setAccount(null);
    setData(null);
    setSelectedShop('');
    setView('overview');
  };

  const changePassword = async () => {
    const next = window.prompt('Nhập mật khẩu mới (tối thiểu 6 ký tự):');
    if (!next) return;
    try {
      await callAction('updateshopaccount', { accountId: account?.id, password: next });
      toast('Đã đổi mật khẩu.');
    } catch (e: any) {
      toast(e.message || 'Đổi mật khẩu thất bại');
    }
  };

  if (loading) {
    return <div className="login-screen"><div className="login-card"><p style={{ textAlign: 'center' }}>Đang tải AChatGo…</p></div></div>;
  }

  if (!account || !data) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={doLogin}>
          <div className="login-logo">AChatGo</div>
          <div className="login-sub">Quản lý bán hàng — đơn hàng, hội thoại, vận chuyển</div>
          {loginError && <div className="error">{loginError}</div>}
          <label>Email hoặc tên đăng nhập
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" placeholder="vd: admin@achat.vn hoặc lua123" />
          </label>
          <label>Mật khẩu
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="btn btn-primary btn-block" type="submit">Đăng nhập</button>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 14 }}>
            Lần đầu chạy: tạo tài khoản Super Admin bằng setupsuperadmin (xem README).
          </p>
        </form>
      </div>
    );
  }

  const pendingOrders = (scoped?.orders || []).filter((o) => o.orderStatus === 'cho_duyet').length;
  const unreadChats = (scoped?.conversations || []).filter((c) => {
    const last = (c.messages || [])[(c.messages || []).length - 1];
    return last?.sender === 'customer';
  }).length;
  const unreadComments = (scoped?.comments || []).filter((c: any) => !c.readAt).length;

  const nav: { section: string; items: NavItem[] }[] = [
    {
      section: 'Bán hàng',
      items: [
        { key: 'overview', label: 'Tổng quan', icon: <LayoutDashboard size={18} /> },
        { key: 'orders', label: 'Đơn hàng', icon: <ShoppingBag size={18} />, badge: pendingOrders || undefined },
        { key: 'products', label: 'Sản phẩm', icon: <Package size={18} /> },
        { key: 'customers', label: 'Khách hàng', icon: <Users size={18} /> },
        { key: 'conversations', label: 'Hội thoại', icon: <MessageSquare size={18} />, badge: unreadChats || undefined },
        { key: 'comments', label: 'Bình luận', icon: <MessagesSquare size={18} />, badge: unreadComments || undefined },
        { key: 'livestream', label: 'Livestream', icon: <Radio size={18} /> },
      ],
    },
    {
      section: 'Marketing',
      items: [
        { key: 'marketing', label: 'Marketing', icon: <Megaphone size={18} /> },
        { key: 'promotions', label: 'Khuyến mãi', icon: <TicketPercent size={18} /> },
      ],
    },
    {
      section: 'Tài chính',
      items: [
        { key: 'cashbook', label: 'Sổ quỹ', icon: <Wallet size={18} /> },
        { key: 'returns', label: 'Trả hàng', icon: <RotateCcw size={18} /> },
        { key: 'stock', label: 'Kho hàng', icon: <Boxes size={18} /> },
        { key: 'reports', label: 'Báo cáo', icon: <BarChart3 size={18} /> },
      ],
    },
    {
      section: 'Kênh & vận chuyển',
      items: [
        {
          key: 'channels', label: 'Kênh bán hàng', icon: <Store size={18} />,
          flyout: [
            { key: 'tiktok', label: 'TikTok Shop' },
            { key: 'shopee', label: 'Shopee' },
            { key: 'facebook', label: 'Facebook' },
          ],
        },
        { key: 'shipping', label: 'Vận chuyển', icon: <Truck size={18} /> },
        { key: 'shipfees', label: 'Cài đặt phí ship', icon: <Settings2 size={18} /> },
      ],
    },
    {
      section: 'AI & Cài đặt',
      items: [
        { key: 'ai', label: 'Trợ lý AI', icon: <Sparkles size={18} /> },
        { key: 'reviews', label: 'Đánh giá', icon: <Star size={18} /> },
        { key: 'settings', label: 'Cài đặt', icon: <Settings size={18} /> },
        { key: 'team', label: 'Nhân viên', icon: <ShieldCheck size={18} /> },
      ],
    },
    {
      section: 'Quản trị',
      items: [
        { key: 'superadmin', label: 'Super Admin', icon: <Crown size={18} />, superOnly: true },
      ],
    },
  ];

  const renderView = () => {
    if (!ctx) return null;
    switch (view) {
      case 'overview': return <OverviewView {...ctx} />;
      case 'orders': return <OrdersView {...ctx} />;
      case 'products': return <ProductsView {...ctx} />;
      case 'customers': return <CustomersView {...ctx} />;
      case 'conversations': return <SocialChatView {...ctx} chatThreadRef={chatThreadRef} />;
      case 'comments': return <CommentsView {...ctx} />;
      case 'livestream': return <LivestreamView {...ctx} />;
      case 'marketing': return <MarketingView {...ctx} />;
      case 'promotions': return <PromotionsView {...ctx} />;
      case 'cashbook': return <CashbookView {...ctx} />;
      case 'returns': return <ReturnsView {...ctx} />;
      case 'stock': return <StockView {...ctx} />;
      case 'reports': return <ReportsView {...ctx} />;
      case 'channels': return <ChannelsView {...ctx} />;
      case 'shipping': return <ShippingView {...ctx} />;
      case 'shipfees': return <ShipFeesView {...ctx} />;
      case 'ai': return <AIView {...ctx} />;
      case 'reviews': return <ReviewsView {...ctx} />;
      case 'settings': return <SettingsView {...ctx} />;
      case 'team': return <TeamView {...ctx} />;
      case 'superadmin': return <SuperAdminView {...ctx} />;
      default: return <OverviewView {...ctx} />;
    }
  };

  const shops = data.shops || [];

  return (
    <div className={`app-shell${createOrderOpen && view === 'conversations' ? ' order-open' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-logo">AChatGo<span className="logo-dot">.</span></div>
        <div className="shop-picker">
          <label className="small" style={{ color: '#7e93a8', marginBottom: 4 }}>Shop</label>
          <select
            value={selectedShop}
            disabled={!isSuperAdmin}
            onChange={(e) => { setSelectedShop(e.target.value); setView('overview'); }}
            title={isSuperAdmin ? 'Super Admin xem tất cả shop' : 'Tài khoản shop chỉ thấy shop của mình'}
          >
            {isSuperAdmin && <option value="">Tất cả shop</option>}
            {shops.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            {shops.length === 0 && <option value="">{account.shopKey || 'Shop của tôi'}</option>}
          </select>
        </div>
        {nav.map((group) => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.filter((it) => !it.superOnly || isSuperAdmin).map((item) => (
              <div key={item.key}>
                <button
                  className={`nav-item ${view === item.key ? 'active' : ''}`}
                  onClick={() => {
                    if (item.flyout) {
                      setFlyout(flyout === item.key ? null : item.key);
                      setView(item.key);
                    } else {
                      setView(item.key);
                    }
                  }}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                  {item.flyout && <ChevronDown size={14} className="nav-caret" />}
                </button>
                {item.flyout && flyout === item.key && (
                  <div className="nav-sub">
                    {item.flyout.map((f) => (
                      <button
                        key={f.key}
                        className="nav-item"
                        onClick={() => { setView(item.key); setChannelFocus(f.key); }}
                      >
                        <span className="nav-label">{f.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        <div className="sidebar-footer">
          <div>
            <span>{account.displayName || account.username || account.email}</span>
            {shopKey ? <span> • {shopKey}</span> : null}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={changePassword}>Đổi mật khẩu</button>
            <button className="btn btn-ghost btn-sm" onClick={doLogout}>Đăng xuất</button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon" onClick={() => setCollapsed((v) => !v)} title={collapsed ? 'Mở sidebar' : 'Thu gọn sidebar'}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <h1>{VIEW_TITLES[view]}</h1>
          <span className="status-pill"><span className="dot" /> Đang hoạt động</span>
          <button className="btn btn-primary" onClick={() => openCreateOrder()}>+ Tạo đơn <span className="kbd">F1</span></button>
        </header>
        <div className="content">{renderView()}</div>
      </div>

      {createOrderOpen && ctx && (
        <CreateOrderView ctx={ctx} prefill={createPrefill} conversation={createConversation} dockedLeft={orderWinLeft} onClose={() => { setCreateOrderOpen(false); setCreatePrefill(undefined); setCreateConversation(undefined); }} />
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
