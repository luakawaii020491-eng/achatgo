/* AChatGo — client SPA tối giản nhưng dùng được thật.
   Mọi dữ liệu đều lấy qua POST /api/action (fetch thật), KHÔNG bịa dữ liệu mẫu.
   Nếu API trả lỗi (vd: src/ chưa triển khai) thì hiện đúng lỗi đó bằng tiếng Việt. */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n) => `${Number(n || 0).toLocaleString("vi-VN")}đ`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let token = localStorage.getItem("achatgo_token") || "";
let account = null;       // tài khoản đã đăng nhập
let bootstrap = null;     // state đã lọc theo shop (từ GET /api/bootstrap)
let currentView = "orders";
let currentShopKey = "";
let orderFilter = { product: "", variant: "" };
let orderLines = [];

/* ---------------- API ---------------- */
async function api(action, args = {}, shopKey) {
  const res = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-account-token": token },
    body: JSON.stringify({ action, args, shopKey: shopKey || currentShopKey || undefined }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Server trả về dữ liệu không hợp lệ" }));
  if (!data.ok) throw new Error(data.error || "Lỗi không xác định từ server");
  return data.data;
}

function showError(msg) {
  const el = $("#error-banner");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearError() { $("#error-banner").classList.add("hidden"); $("#error-banner").textContent = ""; }

/* ---------------- Đăng nhập ---------------- */
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const identifier = $("#login-identifier").value.trim();
  const password = $("#login-password").value;
  const errEl = $("#login-error");
  errEl.classList.add("hidden");
  try {
    // loginaccount: đăng nhập bằng email HOẶC username + mật khẩu.
    const data = await api("loginaccount", { identifier, password });
    token = data.token || data.accountId || data.id;
    if (!token) throw new Error("Server không trả token đăng nhập");
    localStorage.setItem("achatgo_token", token);
    account = data.account || null;
    await loadBootstrap();
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

$("#logout-btn").addEventListener("click", () => {
  token = ""; account = null; bootstrap = null;
  localStorage.removeItem("achatgo_token");
  $("#main-screen").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
});

async function loadBootstrap() {
  const res = await fetch("/api/bootstrap", { headers: { "x-account-token": token } });
  const data = await res.json().catch(() => ({ ok: false, error: "Server trả về dữ liệu không hợp lệ" }));
  if (!data.ok) throw new Error(data.error || "Không tải được dữ liệu shop");
  bootstrap = data.data;
}

function enterApp() {
  $("#login-screen").classList.add("hidden");
  $("#main-screen").classList.remove("hidden");
  const shopList = Array.isArray(bootstrap.shops) ? bootstrap.shops
    : (bootstrap.shops && typeof bootstrap.shops === "object" ? Object.values(bootstrap.shops) : []);
  const sel = $("#shop-select");
  sel.innerHTML = "";
  if (shopList.length === 0) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = account?.shopKey || "Shop của tôi";
    sel.appendChild(opt);
    currentShopKey = account?.shopKey || "";
  } else {
    for (const s of shopList) {
      const opt = document.createElement("option");
      opt.value = s.key || s.id || s.slug || s.name;
      opt.textContent = s.name || opt.value;
      sel.appendChild(opt);
    }
    currentShopKey = account?.shopKey || sel.value;
    sel.value = currentShopKey;
  }
  sel.onchange = () => { currentShopKey = sel.value; renderView(); };
  const isSuper = bootstrap._meta?.isSuperAdmin || account?.role === "superadmin" || account?.role === "super_admin";
  $("#nav-superadmin").classList.toggle("hidden", !isSuper);
  $("#account-info").textContent = `${account?.name || account?.username || account?.email || "Tài khoản"}${currentShopKey ? " • " + currentShopKey : ""}`;
  renderView();
}

/* ---------------- Điều hướng ---------------- */
const VIEW_TITLES = {
  orders: "Đơn hàng", products: "Sản phẩm", customers: "Khách hàng",
  conversations: "Hội thoại", shipping: "Vận chuyển", channels: "Kênh bán hàng",
  shipfees: "Cài đặt phí ship",
  ai: "Trợ lý AI", superadmin: "Super Admin",
};
$$(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    $("#view-title").textContent = VIEW_TITLES[currentView] || "";
    $("#create-order-btn").style.display = currentView === "orders" ? "" : "none";
    renderView();
  });
});
$("#create-order-btn").addEventListener("click", openOrderModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "F1" && currentView === "orders" && !$("#main-screen").classList.contains("hidden")) { e.preventDefault(); openOrderModal(); }
  if (e.key === "F8" && !$("#order-modal").classList.contains("hidden")) { e.preventDefault(); saveOrder(); }
  if (e.key === "Escape") $("#order-modal").classList.add("hidden");
});
$("#order-modal-close").addEventListener("click", () => $("#order-modal").classList.add("hidden"));

async function renderView() {
  clearError();
  const view = $("#view");
  view.innerHTML = '<p class="empty">Đang tải…</p>';
  try {
    if (currentView === "orders") await renderOrders(view);
    else if (currentView === "products") await renderProducts(view);
    else if (currentView === "customers") await renderCustomers(view);
    else if (currentView === "conversations") await renderConversations(view);
    else if (currentView === "shipping") await renderShipping(view);
    else if (currentView === "channels") await renderChannels(view);
    else if (currentView === "shipfees") await renderShipFees(view);
    else if (currentView === "ai") renderAI(view);
    else if (currentView === "superadmin") await renderSuperAdmin(view);
  } catch (err) {
    view.innerHTML = "";
    showError(err.message);
  }
}

/* ---------------- Đơn hàng ---------------- */
async function renderOrders(view) {
  const [orders, products] = await Promise.all([
    api("listorders", {}).catch(() => (bootstrap.orders || [])),
    api("listproducts", {}).catch(() => (bootstrap.products || [])),
  ]);
  const orderList = Array.isArray(orders) ? orders : Object.values(orders || {});
  const productList = Array.isArray(products) ? products : Object.values(products || {});

  const variants = new Set();
  productList.forEach((p) => (p.variants || []).forEach((v) => variants.add(`${p.name} — ${v.color || ""} ${v.size || ""}`.trim())));

  let filtered = orderList;
  if (orderFilter.product) filtered = filtered.filter((o) => (o.items || []).some((i) => (i.productName || i.name || "").includes(orderFilter.product)));
  if (orderFilter.variant) filtered = filtered.filter((o) => (o.items || []).some((i) => `${i.productName || i.name || ""} — ${i.color || ""} ${i.size || ""}`.trim() === orderFilter.variant));

  view.innerHTML = `
    <div class="toolbar">
      <select id="flt-product"><option value="">Tất cả sản phẩm</option>
        ${productList.map((p) => `<option ${orderFilter.product === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
      </select>
      <select id="flt-variant"><option value="">Tất cả biến thể (màu × size)</option>
        ${[...variants].map((v) => `<option ${orderFilter.variant === v ? "selected" : ""}>${esc(v)}</option>`).join("")}
      </select>
    </div>
    ${filtered.length === 0 ? '<div class="empty">Chưa có đơn hàng nào cho shop này.</div>' : `
    <table class="table"><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng COD</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${filtered.map((o) => `
      <tr>
        <td class="mono">${esc(o.code || o.id || "")}</td>
        <td>${esc(o.customerName || o.customer || "")}<br><small>${esc(o.phone || "")}</small></td>
        <td>${(o.items || []).map((i) => esc(`${i.quantity || 1} × ${i.productName || i.name || ""} ${i.color || ""} ${i.size || ""}`)).join("<br>")}</td>
        <td>${fmt(o.totalAmount ?? o.total ?? o.cod)}</td>
        <td><span class="badge">${esc(o.status || "Mới")}</span></td>
        <td>
          <button class="btn" data-push="${esc(o.id || o.code || "")}">Đẩy hãng</button>
          <button class="btn" data-print="${esc(o.id || o.code || "")}">In nhãn</button>
        </td>
      </tr>`).join("")}</tbody></table>`}
  `;
  $("#flt-product").onchange = (e) => { orderFilter.product = e.target.value; renderOrders(view); };
  $("#flt-variant").onchange = (e) => { orderFilter.variant = e.target.value; renderOrders(view); };
  view.querySelectorAll("[data-push]").forEach((b) => b.addEventListener("click", async () => {
    try { const r = await api("pushcarrier", { orderId: b.dataset.push }); alert(r.message || "Đã đẩy sang hãng vận chuyển."); renderView(); }
    catch (err) { showError(err.message); }
  }));
  view.querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", async () => {
    try { const r = await api("printlabel", { orderId: b.dataset.print }); openPrintWindow(r); }
    catch (err) { showError(err.message); }
  }));
}

function openPrintWindow(result) {
  // Nhãn thật do hãng trả qua API giữ nguyên định dạng hãng; ở đây mở nội dung
  // server trả về (URL/base64/HTML). Tên shop theo đơn, SĐT che 6 số đầu.
  const w = window.open("", "_blank");
  if (!w) { showError("Trình duyệt đã chặn cửa sổ in, hãy cho phép popup rồi thử lại."); return; }
  if (result.url) { w.location.href = result.url; return; }
  w.document.write(result.html || `<pre>${esc(JSON.stringify(result, null, 2))}</pre>`);
  w.document.close();
}

/* ---------------- Tạo đơn (form toàn màn hình) ---------------- */
async function openOrderModal() {
  const products = await api("listproducts", {}).catch(() => (bootstrap.products || []));
  window._products = Array.isArray(products) ? products : Object.values(products || {});
  orderLines = [blankLine()];
  renderOrderLines();
  $("#ord-customer").value = ""; $("#ord-phone").value = "";
  $("#ord-address").value = ""; $("#ord-note").value = "";
  $("#ord-error").classList.add("hidden");
  $("#order-modal").classList.remove("hidden");
  updateOrderTotal();
}

function blankLine() { return { productId: "", variantId: "", quantity: 1, price: 0 }; }

function renderOrderLines() {
  const tbody = $("#ord-lines");
  tbody.innerHTML = orderLines.map((line, idx) => {
    const p = window._products.find((x) => (x.id || x.name) === line.productId);
    const variants = p?.variants || [];
    return `<tr>
      <td><select data-line="${idx}" data-field="productId">
        <option value="">— Chọn sản phẩm —</option>
        ${window._products.map((x) => `<option value="${esc(x.id || x.name)}" ${line.productId === (x.id || x.name) ? "selected" : ""}>${esc(x.name)} — ${fmt(x.price)}</option>`).join("")}
      </select></td>
      <td><select data-line="${idx}" data-field="variantId">
        <option value="">— Màu × size —</option>
        ${variants.map((v) => `<option value="${esc(v.id || v.sku || `${v.color}-${v.size}`)}" ${line.variantId === (v.id || v.sku || `${v.color}-${v.size}`) ? "selected" : ""}>${esc(v.color || "")} ${esc(v.size || "")}${v.stock != null ? ` (tồn ${v.stock})` : ""}</option>`).join("")}
      </select></td>
      <td><input type="number" min="1" value="${line.quantity}" data-line="${idx}" data-field="quantity" style="width:70px"></td>
      <td><input type="number" min="0" value="${line.price}" data-line="${idx}" data-field="price" style="width:110px"></td>
      <td>${fmt(line.quantity * line.price)}</td>
      <td><button class="btn btn-danger" data-del-line="${idx}">✕</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("select, input").forEach((el) => el.addEventListener("change", () => {
    const line = orderLines[Number(el.dataset.line)];
    const field = el.dataset.field;
    line[field] = field === "quantity" || field === "price" ? Number(el.value) : el.value;
    if (field === "productId") {
      const p = window._products.find((x) => (x.id || x.name) === line.productId);
      line.price = p?.price || 0; line.variantId = "";
    }
    renderOrderLines(); updateOrderTotal();
  }));
  tbody.querySelectorAll("[data-del-line]").forEach((b) => b.addEventListener("click", () => {
    orderLines.splice(Number(b.dataset.delLine), 1);
    if (orderLines.length === 0) orderLines = [blankLine()];
    renderOrderLines(); updateOrderTotal();
  }));
}

$("#ord-add-line").addEventListener("click", () => { orderLines.push(blankLine()); renderOrderLines(); });

async function updateOrderTotal() {
  const subtotal = orderLines.reduce((s, l) => s + l.quantity * l.price, 0);
  let ship = 0;
  try {
    // Tính phí ship theo quy tắc của shop (miễn ship từ 2 đôi với quai ngang/sục).
    const r = await api("calculateshipping", { items: orderLines, address: $("#ord-address").value });
    ship = r.shippingFee ?? r.fee ?? 0;
  } catch { ship = 0; }
  $("#ord-ship").textContent = fmt(ship);
  $("#ord-total").textContent = fmt(subtotal + ship);
}

$("#ord-save").addEventListener("click", saveOrder);
async function saveOrder() {
  const errEl = $("#ord-error");
  errEl.classList.add("hidden");
  const items = orderLines.filter((l) => l.productId).map((l) => {
    const p = window._products.find((x) => (x.id || x.name) === l.productId);
    const v = (p?.variants || []).find((x) => (x.id || x.sku || `${x.color}-${x.size}`) === l.variantId);
    return { productId: l.productId, productName: p?.name, variantId: l.variantId, color: v?.color, size: v?.size, quantity: l.quantity, price: l.price };
  });
  if (items.length === 0) { errEl.textContent = "Chưa chọn sản phẩm nào."; errEl.classList.remove("hidden"); return; }
  try {
    const r = await api("createorder", {
      customerName: $("#ord-customer").value.trim(),
      phone: $("#ord-phone").value.trim(),
      address: $("#ord-address").value.trim(),
      note: $("#ord-note").value.trim(),
      items,
    });
    $("#order-modal").classList.add("hidden");
    alert(`Đã tạo đơn ${r.code || r.id || ""}.`);
    renderView();
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove("hidden"); }
}

/* ---------------- Sản phẩm ---------------- */
async function renderProducts(view) {
  const products = await api("listproducts", {}).catch(() => (bootstrap.products || []));
  const list = Array.isArray(products) ? products : Object.values(products || {});
  view.innerHTML = list.length === 0
    ? '<div class="empty">Shop chưa có sản phẩm nào. Shop mới bắt đầu trống hoàn toàn — hãy thêm sản phẩm trong Super Admin hoặc nhập lại.</div>'
    : list.map((p) => `
      <div class="card"><h3>${esc(p.name)} — ${fmt(p.price)}</h3>
        <p>${esc(p.description || "")}</p>
        <table class="table"><thead><tr><th>Màu</th><th>Size</th><th>Tồn kho</th><th>SKU</th></tr></thead>
        <tbody>${(p.variants || []).map((v) => `<tr><td>${esc(v.color || "")}</td><td>${esc(v.size || "")}</td><td>${v.stock ?? "—"}</td><td class="mono">${esc(v.sku || "")}</td></tr>`).join("") || '<tr><td colspan="4">Chưa có biến thể.</td></tr>'}</tbody></table>
      </div>`).join("");
}

/* ---------------- Khách hàng ---------------- */
async function renderCustomers(view) {
  const customers = await api("listcustomers", {}).catch(() => (bootstrap.customers || []));
  const list = Array.isArray(customers) ? customers : Object.values(customers || {});
  view.innerHTML = list.length === 0 ? '<div class="empty">Chưa có khách hàng nào.</div>' : `
    <table class="table"><thead><tr><th>Tên</th><th>SĐT</th><th>Địa chỉ</th><th>Số đơn</th></tr></thead>
    <tbody>${list.map((c) => `<tr><td>${esc(c.name || "")}</td><td>${esc(c.phone || "")}</td><td>${esc(c.address || "")}</td><td>${c.orderCount ?? "—"}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------------- Hội thoại ---------------- */
async function renderConversations(view) {
  const convs = await api("listconversations", {}).catch(() => (bootstrap.conversations || []));
  const list = Array.isArray(convs) ? convs : Object.values(convs || {});
  view.innerHTML = list.length === 0 ? '<div class="empty">Chưa có hội thoại nào.</div>' : list.map((c) => `
    <div class="card"><strong>${esc(c.customerName || c.name || "Khách")}</strong>
      <span class="badge">${esc(c.pageName || c.page || "")}</span>
      <p>${esc(c.lastMessage || c.preview || "")}</p>
      <small>${esc(c.updatedAt || "")}</small></div>`).join("");
}

/* ---------------- Vận chuyển ---------------- */
async function renderShipping(view) {
  const orders = await api("listorders", {}).catch(() => (bootstrap.orders || []));
  const list = (Array.isArray(orders) ? orders : Object.values(orders || {})).filter((o) => o.carrier || o.trackingCode || o.status);
  view.innerHTML = `
    <div class="card"><p>Đẩy đơn sang hãng: GHN, GHTK, Viettel Post, Best đã nối thật. <strong>J&T chưa nối thật</strong> (đang chờ duyệt developer) — không đẩy J&T.</p></div>
    ${list.length === 0 ? '<div class="empty">Chưa có đơn nào đã đẩy hãng.</div>' : `
    <table class="table"><thead><tr><th>Mã đơn</th><th>Hãng</th><th>Mã vận đơn</th><th>Trạng thái giao</th><th>Phí hãng</th><th>COD cần thu</th></tr></thead>
    <tbody>${list.map((o) => `<tr><td class="mono">${esc(o.code || o.id || "")}</td><td>${esc(o.carrier || "—")}</td><td class="mono">${esc(o.trackingCode || "—")}</td><td>${esc(o.deliveryStatus || o.status || "—")}</td><td>${o.shippingFee != null ? fmt(o.shippingFee) : "—"}</td><td>${fmt(o.totalAmount ?? o.cod)}</td></tr>`).join("")}</tbody></table>`}
  `;
}

/* ---------------- Kênh bán hàng (TikTok Shop) ---------------- */
async function renderChannels(view) {
  const channelsData = await api("gettiktokchannels", {});
  const channels = channelsData.channels || [];
  const tiktok = channels.find((c) => c.id === "tiktok") || {};
  const facebook = channels.find((c) => c.id === "facebook") || {};
  const cfg = tiktok;
  const shopeeData = await api("getshopeechannels", {});
  const shopeeChannels = shopeeData.channels || [];
  const shopee = shopeeChannels.find((c) => c.id === "shopee") || {};
  const isSuper = bootstrap._meta?.isSuperAdmin || account?.role === "super_admin" || account?.role === "superadmin";
  let platform = null;
  let shopeePlatform = null;
  if (isSuper) {
    try { platform = (await api("gettiktokplatformconfig", {})).platform || null; } catch (e) { platform = null; }
    try { shopeePlatform = (await api("getshopeeplatformconfig", {})).platform || null; } catch (e) { shopeePlatform = null; }
  }
  const maps = (bootstrap.tiktokSkuMaps || []).filter((m) => m.shopKey === currentShopKey);
  const returns = (bootstrap.tiktokReturns || []).filter((r) => r.shopKey === currentShopKey).slice(-5).reverse();
  const finance = (bootstrap.tiktokFinance || []).filter((r) => r.shopKey === currentShopKey).slice(-5).reverse();
  const events = (bootstrap.tiktokWebhookEvents || []).filter((e) => e.shopKey === currentShopKey).slice(-5).reverse();
  const shopeeMaps = (bootstrap.shopeeSkuMaps || []).filter((m) => m.shopKey === currentShopKey);
  const shopeeReturns = (bootstrap.shopeeReturns || []).filter((r) => r.shopKey === currentShopKey).slice(-5).reverse();
  const shopeeFinance = (bootstrap.shopeeFinance || []).filter((r) => r.shopKey === currentShopKey).slice(-5).reverse();
  const shopeeEvents = (bootstrap.shopeeWebhookEvents || []).filter((e) => e.shopKey === currentShopKey).slice(-5).reverse();

  const statusBadge = (s) => s === "connected"
    ? '<span class="badge" style="background:#e6f4ea;color:#137333">Đã kết nối</span>'
    : s === "expired"
    ? '<span class="badge" style="background:#fce8e6;color:#a50e0e">Token hết hạn</span>'
    : s === "revoked"
    ? '<span class="badge" style="background:#fce8e6;color:#a50e0e">Đã hủy ủy quyền</span>'
    : '<span class="badge">Chưa kết nối</span>';

  view.innerHTML = `
    <div class="card">
      <h3>TikTok Shop ${statusBadge(tiktok.status)}</h3>
      <p>${tiktok.shopName ? `Shop TikTok: <strong>${esc(tiktok.shopName)}</strong> (ID ${esc(tiktok.shopId || "")})` : "Chưa kết nối shop TikTok nào."}
      ${tiktok.ordersCount ? ` • ${tiktok.ordersCount} đơn TikTok trong app` : ""}
      ${tiktok.lastSyncAt ? ` • Đồng bộ lần cuối: ${esc(tiktok.lastSyncAt)}` : ""}</p>
      ${tiktok.lastSyncError ? `<p style="color:#d93025">Lỗi đồng bộ gần nhất: ${esc(tiktok.lastSyncError)}</p>` : ""}
      <p>App TikTok chung của AChatGo (1 app cho mọi shop): <strong>${tiktok.platformConfigured ? "đã cấu hình" : "chưa cấu hình"}</strong>${tiktok.platformConfigured ? "" : " — shop chưa kết nối được, liên hệ Super Admin để nhập app chung."}</p>
      <p>Quyền nhắn tin khách (Customer Service): <strong>${cfg.chatScopeGranted ? "đã được cấp" : "chưa được cấp"}</strong>${cfg.chatScopeGranted ? "" : " — TikTok cấp theo yêu cầu trong Partner Center."}</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="tt-connect">Kết nối TikTok</button>
        <button class="btn" id="tt-reload">⟳ Tải lại</button>
        <button class="btn" id="tt-sync-orders">Đồng bộ đơn</button>
        <button class="btn" id="tt-sync-products">Đồng bộ sản phẩm</button>
        <button class="btn" id="tt-sync-returns">Đồng bộ hoàn/trả</button>
        <button class="btn" id="tt-sync-finance">Đồng bộ tài chính</button>
        <button class="btn" id="tt-poll">Poll ngay</button>
        <button class="btn" id="tt-refresh-token">Làm mới token</button>
        <button class="btn" id="tt-register-webhook">Đăng ký webhook</button>
        <button class="btn btn-danger" id="tt-disconnect">Ngắt kết nối</button>
      </div>
    </div>

    ${isSuper ? `
    <div class="card">
      <h3>App TikTok chung — chỉ Super Admin</h3>
      <p>1 app duy nhất cho cả nền tảng AChatGo (mô hình Achat): đăng ký 1 Public app trong TikTok Shop Partner Center (App &amp; Service), nhập app_key/app_secret/service_id <strong>1 lần duy nhất</strong> ở đây. Các shop chỉ bấm "Kết nối TikTok" rồi ủy quyền tài khoản seller — không tự nhập app. <strong>App Key đã che và App Secret không bao giờ hiện lại</strong> — để trống là giữ nguyên. Redirect URI và Webhook URL phải khớp đúng địa chỉ đã đăng ký trong Partner Center. Đổi App Key/Service ID sẽ xóa token ủy quyền của mọi shop (các shop phải kết nối lại).</p>
      <div class="form-grid">
        <label>App Key <input id="tt-appkey" type="text" placeholder="${esc(platform?.appKey || "Chưa nhập")}"></label>
        <label>App Secret <input id="tt-appsecret" type="password" placeholder="${platform?.hasAppSecret ? "Đã lưu — để trống giữ nguyên" : "Chưa nhập"}"></label>
        <label>Service ID <input id="tt-serviceid" type="text" value="${esc(platform?.serviceId || "")}" placeholder="vd: 1234567890123456789"></label>
        <label>Redirect URI <input id="tt-redirect" type="text" value="${esc(platform?.redirectUri || "")}" placeholder="https://achat.vn/auth/tiktok/callback"></label>
        <label>Webhook URL <input id="tt-webhook" type="text" value="${esc(platform?.webhookUrl || "")}" placeholder="https://achat.vn/webhook/tiktok"></label>
        <label>Authorize host <input id="tt-host" type="text" value="${esc(platform?.authorizeHost || "")}" placeholder="services.tiktokshop.com (mặc định)"></label>
        <label>API version <input id="tt-version" type="text" value="${esc(platform?.apiVersion || "202309")}"></label>
      </div>
      <button id="tt-save-config" class="btn btn-primary">Lưu app TikTok chung</button>
    </div>` : ""}

    <div class="card">
      <h3>Map SKU — catalogue nội bộ ↔ TikTok</h3>
      <p>Đồng bộ sản phẩm tự map theo seller_sku trùng SKU nội bộ. SKU nào chưa khớp thì map tay ở đây.</p>
      ${maps.length === 0 ? '<div class="empty">Chưa có SKU nào được map.</div>' : `
      <table class="table"><thead><tr><th>SKU nội bộ</th><th>Sản phẩm TikTok</th><th>SKU TikTok</th><th>Tồn TikTok</th><th>Đồng bộ lần cuối</th><th></th></tr></thead>
      <tbody>${maps.map((m) => `<tr><td class="mono">${esc(m.internalSku)}</td><td>${esc(m.productName || "")}</td><td class="mono">${esc(m.skuId)}</td><td>${m.tiktokStock ?? "—"}</td><td>${esc(m.syncedAt || "")}</td>
        <td><button class="btn btn-danger" data-unmap="${esc(m.id)}">Gỡ map</button></td></tr>`).join("")}</tbody></table>`}
      <div class="form-grid">
        <label>SKU nội bộ <input id="tt-map-sku" type="text" placeholder="vd: DQN-DEN-36"></label>
        <label>Product ID TikTok <input id="tt-map-product" type="text" placeholder="vd: 172..."></label>
        <label>SKU ID TikTok <input id="tt-map-skuid" type="text" placeholder="vd: 172..."></label>
      </div>
      <button id="tt-map-btn" class="btn">Map SKU</button>
      <button id="tt-push-stock" class="btn">Đẩy tồn kho + giá lên TikTok</button>
      <button id="tt-list-products" class="btn">Xem sản phẩm TikTok</button>
      <div id="tt-products"></div>
    </div>

    <div class="card">
      <h3>Hoàn / trả / hủy gần đây</h3>
      ${returns.length === 0 ? '<div class="empty">Chưa có hoàn/trả nào từ TikTok.</div>' : `
      <table class="table"><thead><tr><th>Mã hoàn/trả</th><th>Loại</th><th>Trạng thái</th><th>Đơn app</th><th>Tiền hoàn</th></tr></thead>
      <tbody>${returns.map((r) => `<tr><td class="mono">${esc(r.platformReturnId)}</td><td>${esc(r.kind)}</td><td>${esc(r.status)}</td><td class="mono">${esc(r.orderCode || "")}</td><td>${r.refundAmount != null ? fmt(r.refundAmount) : "—"}</td></tr>`).join("")}</tbody></table>`}
    </div>

    <div class="card">
      <h3>Đối soát tài chính gần đây</h3>
      ${finance.length === 0 ? '<div class="empty">Chưa có sao kê nào từ TikTok.</div>' : `
      <table class="table"><thead><tr><th>Loại</th><th>Mã</th><th>Đơn app</th><th>Số tiền</th></tr></thead>
      <tbody>${finance.map((f) => `<tr><td>${esc(f.kind)}</td><td class="mono">${esc(f.platformId)}</td><td class="mono">${esc(f.orderCode || "")}</td><td>${fmt(f.amount)}</td></tr>`).join("")}</tbody></table>`}
    </div>

    <div class="card">
      <h3>Webhook gần đây</h3>
      ${events.length === 0 ? '<div class="empty">Chưa nhận event webhook nào.</div>' : `
      <table class="table"><thead><tr><th>Event</th><th>Trạng thái</th><th>Nhận lúc</th><th>Ghi chú</th></tr></thead>
      <tbody>${events.map((e) => `<tr><td>${esc(e.eventType)}</td><td>${esc(e.status)}</td><td>${esc(e.receivedAt || "")}</td><td>${esc(e.note || "")}</td></tr>`).join("")}</tbody></table>`}
    </div>

    <div class="card">
      <h3>Shopee ${statusBadge(shopee.status)}</h3>
      <p>${shopee.shopName ? `Shop Shopee: <strong>${esc(shopee.shopName)}</strong> (ID ${esc(shopee.shopId || "")})` : "Chưa kết nối shop Shopee nào."}
      ${shopee.ordersCount ? ` • ${shopee.ordersCount} đơn Shopee trong app` : ""}
      ${shopee.lastSyncAt ? ` • Đồng bộ lần cuối: ${esc(shopee.lastSyncAt)}` : ""}</p>
      ${shopee.lastSyncError ? `<p style="color:#d93025">Lỗi đồng bộ gần nhất: ${esc(shopee.lastSyncError)}</p>` : ""}
      ${shopee.authExpiryWarning ? `<p style="color:#d93025">⚠️ Ủy quyền Shopee sắp hết hạn — bấm "Kết nối Shopee" để ủy quyền lại trước khi hết hạn.</p>` : ""}
      ${shopee.authExpiresAt ? `<p>Ủy quyền tối đa tới: ${esc(shopee.authExpiresAt)} (seller chọn 7–365 ngày; Shopee báo trước 7 ngày).</p>` : ""}
      ${shopee.partnerKeyResetDue ? `<p style="color:#d93025">⚠️ Partner Key của app chung sắp hết hạn 180 ngày — Super Admin cần reset key trong console Shopee.</p>` : ""}
      <p>App Shopee chung của AChatGo (1 app ISV cho mọi shop): <strong>${shopee.platformConfigured ? "đã cấu hình" : "chưa cấu hình"}</strong>${shopee.platformConfigured ? "" : " — shop chưa kết nối được, liên hệ Super Admin để nhập app chung."}</p>
      <p>Nhắn tin khách: <strong>không hỗ trợ qua app</strong> — Shopee đóng Chat API với app mới từ 18/11/2024, trả lời tay trong Seller Center.</p>
      <p>SĐT/địa chỉ khách mặc định bị Shopee che — đơn import vẫn giao được qua logistics Shopee; muốn lấy thông tin thật cần xin quyền sensitive-data trong console.</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="sp-connect">Kết nối Shopee</button>
        <button class="btn" id="sp-reload">⟳ Tải lại</button>
        <button class="btn" id="sp-sync-orders">Đồng bộ đơn</button>
        <button class="btn" id="sp-sync-products">Đồng bộ sản phẩm</button>
        <button class="btn" id="sp-sync-returns">Đồng bộ hoàn/trả</button>
        <button class="btn" id="sp-sync-finance">Đối soát (escrow)</button>
        <button class="btn" id="sp-poll">Poll ngay</button>
        <button class="btn" id="sp-refresh-token">Làm mới token</button>
        <button class="btn btn-danger" id="sp-disconnect">Ngắt kết nối</button>
      </div>
    </div>

    ${isSuper ? `
    <div class="card">
      <h3>App Shopee chung — chỉ Super Admin</h3>
      <p>1 app ISV duy nhất cho cả nền tảng AChatGo (mô hình Achat): đăng ký 1 app Third-Party Partner tại <strong>open.shopee.com</strong> (cần giấy tờ doanh nghiệp, duyệt ~10 ngày làm việc), nhập partner_id/partner_key <strong>1 lần duy nhất</strong> ở đây. Các shop chỉ bấm "Kết nối Shopee" rồi ủy quyền tài khoản seller — không tự nhập app. <strong>Partner ID đã che và Partner Key không bao giờ hiện lại</strong> — để trống là giữ nguyên. Redirect URI và Webhook URL phải khớp đúng địa chỉ đã đăng ký trong console Shopee. Đổi Partner ID sẽ xóa token ủy quyền của mọi shop (các shop phải kết nối lại). <strong>Partner Key hết hạn sau 180 ngày</strong> — reset key trong console rồi nhập key mới vào đây.</p>
      ${shopeePlatform?.partnerKeyResetDue ? `<p style="color:#d93025">⚠️ Partner Key đã ${shopeePlatform.partnerKeyAgeDays ?? "?"} ngày tuổi — sắp tới hạn reset 180 ngày.</p>` : ""}
      <div class="form-grid">
        <label>Partner ID <input id="sp-partnerid" type="text" placeholder="${esc(shopeePlatform?.partnerId || "Chưa nhập")}"></label>
        <label>Partner Key <input id="sp-partnerkey" type="password" placeholder="${shopeePlatform?.hasPartnerKey ? "Đã lưu — để trống giữ nguyên" : "Chưa nhập"}"></label>
        <label>Redirect URI <input id="sp-redirect" type="text" value="${esc(shopeePlatform?.redirectUri || "")}" placeholder="https://achat.vn/auth/shopee/callback"></label>
        <label>Webhook URL <input id="sp-webhook" type="text" value="${esc(shopeePlatform?.webhookUrl || "")}" placeholder="https://achat.vn/webhook/shopee"></label>
        <label>API host <input id="sp-host" type="text" value="${esc(shopeePlatform?.apiHost || "")}" placeholder="https://partner.shopeemobile.com (mặc định)"></label>
        <label><input id="sp-sandbox" type="checkbox" ${shopeePlatform?.sandbox ? "checked" : ""}> Dùng sandbox (partner.test-stable.shopeemobile.com)</label>
      </div>
      <button id="sp-save-config" class="btn btn-primary">Lưu app Shopee chung</button>
    </div>` : ""}

    <div class="card">
      <h3>Map SKU — catalogue nội bộ ↔ Shopee</h3>
      <p>Đồng bộ sản phẩm tự map theo model_sku/item_sku trùng SKU nội bộ. SKU nào chưa khớp thì map tay ở đây.</p>
      ${shopeeMaps.length === 0 ? '<div class="empty">Chưa có SKU nào được map.</div>' : `
      <table class="table"><thead><tr><th>SKU nội bộ</th><th>Sản phẩm Shopee</th><th>Item ID / Model ID</th><th>Tồn Shopee</th><th>Đồng bộ lần cuối</th><th></th></tr></thead>
      <tbody>${shopeeMaps.map((m) => `<tr><td class="mono">${esc(m.internalSku)}</td><td>${esc(m.productName || "")}</td><td class="mono">${esc(m.itemId)} / ${esc(m.modelId || "—")}</td><td>${m.shopeeStock ?? "—"}</td><td>${esc(m.syncedAt || "")}</td>
        <td><button class="btn btn-danger" data-unmap-shopee="${esc(m.id)}">Gỡ map</button></td></tr>`).join("")}</tbody></table>`}
      <div class="form-grid">
        <label>SKU nội bộ <input id="sp-map-sku" type="text" placeholder="vd: DQN-DEN-36"></label>
        <label>Item ID Shopee <input id="sp-map-item" type="text" placeholder="vd: 1001"></label>
        <label>Model ID Shopee <input id="sp-map-model" type="text" placeholder="vd: 2001 (để trống nếu item không có model)"></label>
      </div>
      <button id="sp-map-btn" class="btn">Map SKU</button>
      <button id="sp-push-stock" class="btn">Đẩy tồn kho + giá lên Shopee</button>
      <button id="sp-list-products" class="btn">Xem sản phẩm Shopee</button>
      <div id="sp-products"></div>
    </div>

    <div class="card">
      <h3>Hoàn / trả gần đây (Shopee)</h3>
      ${shopeeReturns.length === 0 ? '<div class="empty">Chưa có hoàn/trả nào từ Shopee.</div>' : `
      <table class="table"><thead><tr><th>Mã hoàn/trả</th><th>Loại</th><th>Trạng thái</th><th>Đơn app</th><th>Tiền hoàn</th></tr></thead>
      <tbody>${shopeeReturns.map((r) => `<tr><td class="mono">${esc(r.platformReturnId)}</td><td>${esc(r.kind)}</td><td>${esc(r.status)}</td><td class="mono">${esc(r.orderCode || "")}</td><td>${r.refundAmount != null ? fmt(r.refundAmount) : "—"}</td></tr>`).join("")}</tbody></table>`}
    </div>

    <div class="card">
      <h3>Đối soát tài chính gần đây (Shopee escrow)</h3>
      ${shopeeFinance.length === 0 ? '<div class="empty">Chưa có sao kê nào từ Shopee.</div>' : `
      <table class="table"><thead><tr><th>Loại</th><th>Mã</th><th>Đơn app</th><th>Số tiền</th></tr></thead>
      <tbody>${shopeeFinance.map((f) => `<tr><td>${esc(f.kind)}</td><td class="mono">${esc(f.platformId)}</td><td class="mono">${esc(f.orderCode || "")}</td><td>${fmt(f.amount)}</td></tr>`).join("")}</tbody></table>`}
    </div>

    <div class="card">
      <h3>Push webhook gần đây (Shopee)</h3>
      ${shopeeEvents.length === 0 ? '<div class="empty">Chưa nhận event push nào.</div>' : `
      <table class="table"><thead><tr><th>Event</th><th>Trạng thái</th><th>Nhận lúc</th><th>Ghi chú</th></tr></thead>
      <tbody>${shopeeEvents.map((e) => `<tr><td>${esc(e.eventType)}</td><td>${esc(e.status)}</td><td>${esc(e.receivedAt || "")}</td><td>${esc(e.note || "")}</td></tr>`).join("")}</tbody></table>`}
    </div>

    <div class="card">
      <h3>Facebook Messenger ${statusBadge(facebook.status)}</h3>
      <p>${esc(facebook.note || "Quản lý ở màn Kết nối Meta.")} ${facebook.ordersCount ? `• ${facebook.ordersCount} đơn Facebook trong app.` : ""}</p>
    </div>
  `;

  const busy = (btnId, fn, doneMsg, rerender = true) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "Đang xử lý…";
      try {
        const r = await fn();
        if (doneMsg) alert(typeof doneMsg === "function" ? doneMsg(r) : doneMsg);
        if (rerender) renderView();
        else { btn.disabled = false; btn.textContent = old; }
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  };

  busy("#tt-connect", async () => {
    const r = await api("gettiktokoauthurl", {});
    window.open(r.url, "_blank");
    return r;
  }, "Đã mở trang ủy quyền TikTok trong tab mới. Hoàn tất ủy quyền rồi bấm ⟳ Tải lại để xem trạng thái.", false);
  $("#tt-reload").addEventListener("click", () => renderView());
  busy("#tt-sync-orders", () => api("synctiktokorders", { daysBack: 7 }),
    (r) => `Đồng bộ đơn TikTok: ${r.fetched} đơn lấy về, ${r.created} mới, ${r.updated} cập nhật.${r.errors && r.errors.length ? " Lỗi: " + r.errors[0] : ""}`);
  busy("#tt-sync-products", () => api("synctiktokproducts", {}),
    (r) => `Đồng bộ sản phẩm: ${r.fetchedProducts} sản phẩm, ${r.matched} SKU khớp, ${r.createdMaps} map mới.${r.unmatchedCount ? " " + r.unmatchedCount + " SKU chưa khớp (map tay ở dưới)." : ""}`);
  busy("#tt-sync-returns", () => api("synctiktokreturns", { daysBack: 30 }),
    (r) => `Hoàn/trả: ${r.returns} hoàn + ${r.cancellations} hủy, ${r.created} mới, ${r.slips} phiếu trả.`);
  busy("#tt-sync-finance", () => api("synctiktokfinance", { daysBack: 30 }),
    (r) => `Tài chính: ${r.statements} sao kê, ${r.transactions} giao dịch, ${r.withdrawals} lần rút, ${r.matchedOrders} đơn đã khớp.${r.warnings && r.warnings.length ? " Lưu ý: " + r.warnings[0] : ""}`);
  busy("#tt-poll", () => api("tiktokpoll", {}), (r) => `Poll xong lúc ${r.polledAt}.`);
  busy("#tt-refresh-token", () => api("refreshtiktoktoken", {}), "Đã làm mới token TikTok.");
  busy("#tt-register-webhook", () => api("registertiktokwebhook", {}),
    (r) => `Đăng ký webhook: ${r.registered} thành công, ${r.failed} thất bại.${r.failed ? " Xem chi tiết trong bảng webhook." : ""}`);
  busy("#tt-disconnect", async () => {
    if (!confirm("Ngắt kết nối TikTok Shop? Token sẽ bị xóa, cần ủy quyền lại để đồng bộ tiếp.")) throw new Error("Đã hủy.");
    return api("disconnecttiktok", {});
  }, "Đã ngắt kết nối TikTok Shop.");

  const saveBtn = $("#tt-save-config");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const config = {
      serviceId: $("#tt-serviceid").value.trim(),
      redirectUri: $("#tt-redirect").value.trim(),
      webhookUrl: $("#tt-webhook").value.trim(),
      authorizeHost: $("#tt-host").value.trim(),
      apiVersion: $("#tt-version").value.trim(),
    };
    const appKey = $("#tt-appkey").value.trim();
    const appSecret = $("#tt-appsecret").value;
    if (appKey) config.appKey = appKey;
    if (appSecret) config.appSecret = appSecret;
    try {
      const r = await api("savetiktokplatformconfig", { config });
      alert(r.tokensCleared
        ? "Đã lưu app TikTok chung. App Key/Service ID đã đổi nên token ủy quyền của mọi shop đã bị xóa — các shop cần bấm \"Kết nối TikTok\" để ủy quyền lại."
        : "Đã lưu app TikTok chung.");
      renderView();
    } catch (err) { showError(err.message); }
  });

  $("#tt-map-btn").addEventListener("click", async () => {
    const internalSku = $("#tt-map-sku").value.trim();
    const productId = $("#tt-map-product").value.trim();
    const skuId = $("#tt-map-skuid").value.trim();
    if (!internalSku || !productId || !skuId) { showError("Nhập đủ SKU nội bộ, Product ID và SKU ID TikTok."); return; }
    try {
      await api("maptiktoksku", { internalSku, productId, skuId });
      alert("Đã map SKU.");
      renderView();
    } catch (err) { showError(err.message); }
  });

  busy("#tt-push-stock", () => api("pushtiktokstock", { mode: "both" }),
    (r) => `Đẩy lên TikTok: ${r.pushed} thành công, ${r.failed} thất bại.${r.failed ? " Lỗi đầu tiên: " + (r.results.find((x) => !x.ok) || {}).error : ""}`);
  $("#tt-list-products").addEventListener("click", async () => {
    const box = $("#tt-products");
    box.innerHTML = '<p class="empty">Đang tải sản phẩm TikTok…</p>';
    try {
      const r = await api("gettiktokproducts", { pageSize: 20 });
      const list = r.products || [];
      box.innerHTML = list.length === 0 ? '<div class="empty">TikTok Shop chưa có sản phẩm nào.</div>' : `
        <table class="table"><thead><tr><th>Sản phẩm</th><th>Trạng thái</th><th>SKU (seller_sku)</th><th>Giá</th><th>Tồn</th><th>Map nội bộ</th></tr></thead>
        <tbody>${list.map((p) => (p.skus || []).map((s) => `<tr><td>${esc(p.name)}</td><td>${esc(p.status || "")}</td><td class="mono">${esc(s.sellerSku || s.id)}</td><td>${s.price != null ? fmt(Number(s.price)) : "—"}</td><td>${s.stock ?? "—"}</td><td class="mono">${esc(s.mappedInternalSku || "— chưa map —")}</td></tr>`).join("") || `<tr><td>${esc(p.name)}</td><td colspan="5">Chưa có SKU.</td></tr>`).join("")}</tbody></table>`;
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });

  /* ---------------- Shopee ---------------- */
  busy("#sp-connect", async () => {
    const r = await api("getshopeeoauthurl", {});
    window.open(r.url, "_blank");
    return r;
  }, "Đã mở trang ủy quyền Shopee trong tab mới. Hoàn tất ủy quyền rồi bấm ⟳ Tải lại để xem trạng thái.", false);
  $("#sp-reload").addEventListener("click", () => renderView());
  busy("#sp-sync-orders", () => api("syncshopeeorders", { daysBack: 7 }),
    (r) => `Đồng bộ đơn Shopee: ${r.fetched} đơn lấy về, ${r.created} mới, ${r.updated} cập nhật.${r.errors && r.errors.length ? " Lỗi: " + r.errors[0] : ""}`);
  busy("#sp-sync-products", () => api("syncshopeeproducts", {}),
    (r) => `Đồng bộ sản phẩm: ${r.fetchedProducts} sản phẩm, ${r.matched} SKU khớp, ${r.createdMaps} map mới.${r.unmatchedCount ? " " + r.unmatchedCount + " SKU chưa khớp (map tay ở dưới)." : ""}`);
  busy("#sp-sync-returns", () => api("syncshopeereturns", { daysBack: 30 }),
    (r) => `Hoàn/trả: ${r.returns} hoàn/trả, ${r.created} mới, ${r.slips} phiếu trả.`);
  busy("#sp-sync-finance", () => api("syncshopeefinance", { daysBack: 30 }),
    (r) => `Đối soát: ${r.escrows} escrow, ${r.payouts} lần rút, ${r.matchedOrders} đơn đã khớp.${r.errors && r.errors.length ? " Lưu ý: " + r.errors[0] : ""}`);
  busy("#sp-poll", () => api("shopeepoll", {}), (r) => `Poll xong lúc ${r.polledAt}.`);
  busy("#sp-refresh-token", () => api("refreshshopeetoken", {}), "Đã làm mới token Shopee.");
  busy("#sp-disconnect", async () => {
    if (!confirm("Ngắt kết nối Shopee? Token sẽ bị xóa, cần ủy quyền lại để đồng bộ tiếp.")) throw new Error("Đã hủy.");
    return api("disconnectshopee", {});
  }, "Đã ngắt kết nối Shopee.");

  const spSaveBtn = $("#sp-save-config");
  if (spSaveBtn) spSaveBtn.addEventListener("click", async () => {
    const config = {
      redirectUri: $("#sp-redirect").value.trim(),
      webhookUrl: $("#sp-webhook").value.trim(),
      apiHost: $("#sp-host").value.trim(),
      sandbox: $("#sp-sandbox").checked,
    };
    const partnerId = $("#sp-partnerid").value.trim();
    const partnerKey = $("#sp-partnerkey").value;
    if (partnerId) config.partnerId = partnerId;
    if (partnerKey) config.partnerKey = partnerKey;
    try {
      const r = await api("saveshopeeplatformconfig", { config });
      alert(r.tokensCleared
        ? "Đã lưu app Shopee chung. Partner ID đã đổi nên token ủy quyền của mọi shop đã bị xóa — các shop cần bấm \"Kết nối Shopee\" để ủy quyền lại."
        : "Đã lưu app Shopee chung.");
      renderView();
    } catch (err) { showError(err.message); }
  });

  $("#sp-map-btn").addEventListener("click", async () => {
    const internalSku = $("#sp-map-sku").value.trim();
    const itemId = $("#sp-map-item").value.trim();
    const modelId = $("#sp-map-model").value.trim();
    if (!internalSku || !itemId) { showError("Nhập đủ SKU nội bộ và Item ID Shopee."); return; }
    try {
      await api("mapshopeesku", { internalSku, itemId, modelId });
      alert("Đã map SKU.");
      renderView();
    } catch (err) { showError(err.message); }
  });

  busy("#sp-push-stock", () => api("pushshopeestock", { mode: "both" }),
    (r) => `Đẩy lên Shopee: ${r.pushed} thành công, ${r.failed} thất bại.${r.failed ? " Lỗi đầu tiên: " + (r.results.find((x) => !x.ok) || {}).error : ""}`);
  $("#sp-list-products").addEventListener("click", async () => {
    const box = $("#sp-products");
    box.innerHTML = '<p class="empty">Đang tải sản phẩm Shopee…</p>';
    try {
      const r = await api("getshopeeproducts", { pageSize: 20 });
      const list = r.products || [];
      box.innerHTML = list.length === 0 ? '<div class="empty">Shopee chưa có sản phẩm nào.</div>' : `
        <table class="table"><thead><tr><th>Sản phẩm</th><th>Trạng thái</th><th>SKU (model_sku)</th><th>Giá</th><th>Tồn</th><th>Map nội bộ</th></tr></thead>
        <tbody>${list.map((p) => (p.skus || []).map((s) => `<tr><td>${esc(p.name)}</td><td>${esc(p.status || "")}</td><td class="mono">${esc(s.modelSku || s.id)}</td><td>${s.price != null ? fmt(Number(s.price)) : "—"}</td><td>${s.stock ?? "—"}</td><td class="mono">${esc(s.mappedInternalSku || "— chưa map —")}</td></tr>`).join("") || `<tr><td>${esc(p.name)}</td><td colspan="5">Chưa có SKU.</td></tr>`).join("")}</tbody></table>`;
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });

  view.querySelectorAll("[data-unmap-shopee]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Gỡ map SKU này? Đơn Shopee về sau sẽ không khớp catalogue.")) return;
    try { await api("unmapshopeesku", { id: b.dataset.unmapShopee }); renderView(); }
    catch (err) { showError(err.message); }
  }));

  view.querySelectorAll("[data-unmap]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Gỡ map SKU này? Đơn TikTok về sau sẽ không khớp catalogue.")) return;
    try { await api("unmaptiktoksku", { id: b.dataset.unmap }); renderView(); }
    catch (err) { showError(err.message); }
  }));
}

/* ---------------- Cài đặt phí ship ---------------- */
async function renderShipFees(view) {
  const rules = await api("listshippingrules", {}).catch(() => (bootstrap.shippingRules || []));
  const list = Array.isArray(rules) ? rules : Object.values(rules || {});
  view.innerHTML = `
    <div class="card"><p>Phí ship theo <strong>loại sản phẩm / từng sản phẩm</strong> — không theo Page/Fanpage.</p></div>
    ${list.length === 0 ? '<div class="empty">Shop chưa có quy tắc phí ship nào.</div>' : `
    <table class="table"><thead><tr><th>Loại / Sản phẩm</th><th>Phí 1 đôi</th><th>Miễn ship từ</th><th></th></tr></thead>
    <tbody>${list.map((r) => `<tr><td>${esc(r.productType || r.productName || r.name || "")}</td><td>${fmt(r.fee)}</td><td>${r.freeFrom != null ? r.freeFrom + " đôi" : "—"}</td>
      <td><button class="btn" data-edit-rule="${esc(r.id)}">Sửa</button> <button class="btn btn-danger" data-del-rule="${esc(r.id)}">Xóa</button></td></tr>`).join("")}</tbody></table>`}
    <button id="add-rule-btn" class="btn btn-primary">+ Thêm quy tắc</button>
  `;
  $("#add-rule-btn").addEventListener("click", async () => {
    const productType = prompt("Loại sản phẩm (vd: Quai ngang):");
    if (!productType) return;
    const fee = Number(prompt("Phí ship 1 đôi (đ):", "30000") || 0);
    const freeFrom = Number(prompt("Miễn ship từ mấy đôi (vd: 2):", "2") || 0);
    try { await api("createshippingrule", { productType, fee, freeFrom }); renderView(); }
    catch (err) { showError(err.message); }
  });
  view.querySelectorAll("[data-del-rule]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Xóa quy tắc này?")) return;
    try { await api("deleteshippingrule", { id: b.dataset.delRule }); renderView(); }
    catch (err) { showError(err.message); }
  }));
  view.querySelectorAll("[data-edit-rule]").forEach((b) => b.addEventListener("click", async () => {
    const fee = Number(prompt("Phí ship mới (đ):", "30000") || 0);
    try { await api("updateshippingrule", { id: b.dataset.editRule, fee }); renderView(); }
    catch (err) { showError(err.message); }
  }));
}

/* ---------------- Trợ lý AI ---------------- */
function renderAI(view) {
  view.innerHTML = `
    <div class="chat-box" id="ai-chat"><p class="chat-msg">Trợ lý AI AChatGo — hỏi về đơn hàng, sản phẩm, phí ship của shop.</p></div>
    <div class="chat-row"><input id="ai-input" type="text" placeholder="Nhập câu hỏi…" autocomplete="off">
    <button id="ai-send" class="btn btn-primary">Gửi</button></div>`;
  const send = async () => {
    const input = $("#ai-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const box = $("#ai-chat");
    box.insertAdjacentHTML("beforeend", `<p class="chat-msg user">${esc(text)}</p>`);
    try {
      const r = await api("assistantchat", { message: text });
      box.insertAdjacentHTML("beforeend", `<p class="chat-msg">${esc(r.reply || r.answer || r.message || "")}</p>`);
    } catch (err) {
      box.insertAdjacentHTML("beforeend", `<p class="chat-msg" style="color:#d93025">${esc(err.message)}</p>`);
    }
    box.scrollTop = box.scrollHeight;
  };
  $("#ai-send").addEventListener("click", send);
  $("#ai-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
}

/* ---------------- Super Admin ---------------- */
async function renderSuperAdmin(view) {
  const shops = await api("listshops", {}).catch(() => (bootstrap.shops || []));
  const list = Array.isArray(shops) ? shops : Object.values(shops || {});
  view.innerHTML = `
    <div class="card"><p>Super Admin: thêm shop, duyệt dùng thử, quản lý gói và khóa AI từng shop. Dữ liệu shop cũ chỉ Super Admin thấy.</p></div>
    ${list.length === 0 ? '<div class="empty">Chưa có shop nào.</div>' : `
    <table class="table"><thead><tr><th>Shop</th><th>Tên miền</th><th>Gói</th><th>Page / Nhân viên</th><th>Hết hạn dùng thử</th></tr></thead>
    <tbody>${list.map((s) => `<tr><td>${esc(s.name || "")}</td><td class="mono">${esc(s.domain || (s.key ? s.key + ".achat.vn" : ""))}</td><td>${esc(s.plan || "")}</td><td>${s.pageLimit ?? "—"} / ${s.staffLimit ?? "—"}</td><td>${esc(s.trialEndsAt || s.trialEnd || "—")}</td></tr>`).join("")}</tbody></table>`}
    <button id="add-shop-btn" class="btn btn-primary">+ Thêm shop</button>
  `;
  $("#add-shop-btn").addEventListener("click", async () => {
    const name = prompt("Tên shop:");
    if (!name) return;
    const key = prompt("Tên miền riêng (vd: luaxinh — sẽ thành luaxinh.achat.vn):", name.toLowerCase().replace(/\s+/g, ""));
    try { await api("createshop", { name, key }); renderView(); }
    catch (err) { showError(err.message); }
  });
}

/* ---------------- Khởi động ---------------- */
if (token) {
  loadBootstrap().then(() => { enterApp(); }).catch(() => {
    token = ""; localStorage.removeItem("achatgo_token");
  });
}
