/**
 * AChatGo — server standalone (tái tạo từ bản artifact v37).
 *
 * Entry duy nhất của app: Express phục vụ client tĩnh (public/) + API.
 *
 * GIAO DIỆN VỚI CODE SERVER (nằm trong src/, do agent khác viết):
 *   - src/store.ts  export loadState(): Promise<State>    (async; Postgres
 *                   khi có DATABASE_URL, file JSON khi không có)
 *                   export saveState(state): Promise<void>  (async, nối đuôi)
 *                   export createEmptyState(): State
 *                   export scopeState(state, role, shopKey): State
 *                   (lọc state theo quyền xem; KHÔNG tự tẩy passwordHash)
 *   - src/auth.ts   export loginAccount(state, emailOrUsername, password)
 *                     -> { ok: true, account: PublicAccount } | { ok: false, error }
 *                   export toPublicAccount(account): PublicAccount (bỏ passwordHash)
 *                   export hashPassword / verifyPassword (bcrypt)
 *   - src/pricing.ts export computeShipFee / computeOrderTotals / codTotalFor
 *   - src/seed.ts   export seedInitialState(): State (seed v38, không dữ liệu thật)
 *   - src/actions.ts export handleAction(state, actionName, args, ctx)
 *                     -> { ok: true, data } | { ok: false, error }
 *                     (dispatcher 151 action, gồm 22 action TikTok Shop;
 *                     xem src/actions.ts). Ngoài ra export
 *                     handleTikTokWebhook + processStoredTikTokWebhookEvent
 *                     cho route /webhook/tiktok.
 *
 * Logic nghiệp vụ nằm hoàn toàn trong src/; file này chỉ làm HTTP +
 * xác thực + xác định shop + lưu state.
 */

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "url";
import path from "path";

const VERSION = "v40-standalone";
const PORT = Number(process.env.PORT ?? 10000);

// ---------------------------------------------------------------------------
// Nạp src/ theo đúng giao diện thật. store và auth nạp riêng từng cái để
// một module thiếu không kéo sập cả hai; actions là tùy chọn cho tới khi
// agent server viết xong src/actions.ts.
// ---------------------------------------------------------------------------
type StoreModule = {
  loadState: () => Promise<any>;
  saveState: (state: any) => Promise<void>;
  createEmptyState: () => any;
  scopeState: (state: any, role: string, shopKey: string | null) => any;
};
type AuthModule = {
  loginAccount: (state: any, identifier: string, password: string) => any;
  toPublicAccount: (account: any) => any;
  maskSecret?: (s: string) => string;
};
type ActionsModule = {
  handleAction: (state: any, actionName: string, args: any, ctx: any) => Promise<any> | any;
  handleTikTokWebhook?: (state: any, opts: any) => Promise<any> | any;
  processStoredTikTokWebhookEvent?: (state: any, eventId: string) => Promise<any> | any;
  handleShopeePush?: (state: any, opts: any) => Promise<any> | any;
  processStoredShopeePushEvent?: (state: any, eventId: string) => Promise<any> | any;
};

let store: StoreModule | null = null;
let auth: AuthModule | null = null;
let actions: ActionsModule | null = null;

async function loadServerModules(): Promise<void> {
  try {
    store = (await import("./src/store.js")) as StoreModule;
    if (typeof store.loadState !== "function" || typeof store.saveState !== "function") {
      throw new Error("src/store.ts thiếu loadState/saveState");
    }
    console.log("[achatgo] đã nạp src/store.ts (loadState/saveState async — Postgres khi có DATABASE_URL, file JSON khi không)");
  } catch (err) {
    console.warn("[achatgo] CHƯA nạp được src/store.ts:", (err as Error).message);
    store = null;
  }
  try {
    auth = (await import("./src/auth.js")) as AuthModule;
    console.log("[achatgo] đã nạp src/auth.ts (loginAccount bcrypt)");
  } catch (err) {
    console.warn("[achatgo] CHƯA nạp được src/auth.ts:", (err as Error).message);
    auth = null;
  }
  try {
    // Đường dẫn qua biến (không phải literal) để `tsc` không báo lỗi khi
    // src/actions.ts chưa tồn tại; import động ở runtime vẫn bắt lỗi này.
    const actionsPath = "./src/actions.js";
    actions = (await import(actionsPath)) as ActionsModule;
    if (typeof actions.handleAction !== "function") throw new Error("thiếu handleAction");
    console.log("[achatgo] đã nạp src/actions.ts (handleAction)");
  } catch (err) {
    console.warn(
      "[achatgo] src/actions.ts CHƯA CÓ — các action nghiệp vụ sẽ trả lỗi chưa-triển-khai:",
      (err as Error).message,
    );
    actions = null;
  }
}

// ---------------------------------------------------------------------------
// Trạng thái + xác thực tối giản
// ---------------------------------------------------------------------------
let state: any = null;

function isWriteAction(actionName: string): boolean {
  // Các action chỉ đọc không cần lưu state; còn lại lưu sau mỗi lần gọi.
  const readOnly = new Set([
    "listorders",
    "listproducts",
    "listcustomers",
    "listconversations",
    "listshippingrules",
    "getshop",
    "bootstrap",
    // TikTok: chỉ đọc, không đổi state (đồng bộ vẫn là action ghi).
    "gettiktokplatformconfig",
    "gettiktokoauthurl",
    "gettiktokchannels",
    "gettiktokproducts",
    // Shopee: chỉ đọc, không đổi state (đồng bộ vẫn là action ghi).
    "getshopeeplatformconfig",
    "getshopeeoauthurl",
    "getshopeechannels",
    "getshopeeproducts",
  ]);
  return !readOnly.has(actionName);
}

/**
 * Xác thực tối giản cho bản standalone: token = id tài khoản, kiểm tra trong
 * state.accounts. ⚠️ Đây là xác thực tối giản — cần tăng cường (session có
 * hạn, hash token, rate-limit, chống brute-force) trước khi mở cho shop lạ.
 */
function authenticate(req: Request): any | null {
  const token = req.header("x-account-token");
  if (!token || !state?.accounts) return null;
  return state.accounts.find((a: any) => a?.id === token) ?? null;
}

function isSuperAdmin(account: any): boolean {
  return account?.role === "super_admin" || account?.role === "superadmin";
}

/**
 * Xác định shop từ subdomain:
 *   <tenshop>.achat.vn → shopKey = <tenshop> (khớp Shop.key, vd 'xinh')
 *   achat.vn (gốc)    → null = Super Admin thấy tất cả shop
 *   localhost / IP     → null (dev: thấy tất cả, lọc ở client theo tài khoản)
 */
function shopKeyFromHost(req: Request): string | null {
  const host = (req.header("host") ?? "").split(":")[0].toLowerCase();
  if (host.endsWith(".achat.vn")) {
    const sub = host.slice(0, -".achat.vn".length);
    return sub && sub !== "www" ? sub : null;
  }
  return null;
}

function maskSecretForClient(s: string): string {
  if (auth?.maskSecret) return auth.maskSecret(s);
  if (!s) return '';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(0, s.length - 8))}${s.slice(-4)}`;
}

/**
 * Tẩy secret khỏi state trả cho client — BẮT BUỘC vì scopeState trả về
 * tham chiếu tới shop gốc (tài khoản shop thường), nên phải clone từng
 * shop trước khi xóa (không được delete trực tiếp trên object gốc).
 * Trước đây GET /api/bootstrap trả nguyên shop gồm meta.appSecret,
 * tiktok.appSecret/accessToken/refreshToken, capiAccessToken.
 */
function stripShopSecrets(scoped: any): void {
  if (Array.isArray(scoped.shops)) {
    scoped.shops = scoped.shops.map((shop: any) => {
      const copy: any = { ...shop };
      if (shop.meta) {
        const m: any = { ...shop.meta };
        delete m.appSecret;
        delete m.userAccessToken;
        copy.meta = m;
      }
      if (shop.tiktok) {
        const t: any = { ...shop.tiktok };
        delete t.appSecret;
        delete t.accessToken;
        delete t.refreshToken;
        if (typeof t.appKey === 'string' && t.appKey) t.appKey = maskSecretForClient(t.appKey);
        if (typeof t.shopCipher === 'string' && t.shopCipher) t.shopCipher = maskSecretForClient(t.shopCipher);
        copy.tiktok = t;
      }
      if (shop.shopee) {
        const s: any = { ...shop.shopee };
        delete s.accessToken;
        delete s.refreshToken;
        copy.shopee = s;
      }
      delete copy.capiAccessToken;
      delete copy.aiKeyHash;
      return copy;
    });
  }
  // App TikTok CHUNG (mô hình Achat): appSecret không bao giờ ra client,
  // appKey chỉ hiện dạng đã che — kể cả với Super Admin (form nhập không
  // prefill secret, để trống là giữ nguyên).
  if ((scoped as any).tiktokPlatform) {
    const tp: any = { ...(scoped as any).tiktokPlatform };
    delete tp.appSecret;
    if (typeof tp.appKey === 'string' && tp.appKey) tp.appKey = maskSecretForClient(tp.appKey);
    (scoped as any).tiktokPlatform = tp;
  }
  // App Shopee CHUNG (mô hình Achat): partnerKey không bao giờ ra client,
  // partnerId chỉ hiện dạng đã che — kể cả với Super Admin (form nhập không
  // prefill key, để trống là giữ nguyên).
  if ((scoped as any).shopeePlatform) {
    const sp: any = { ...(scoped as any).shopeePlatform };
    delete sp.partnerKey;
    if (typeof sp.partnerId === 'string' && sp.partnerId) sp.partnerId = maskSecretForClient(sp.partnerId);
    (scoped as any).shopeePlatform = sp;
  }
  // CAPI access token theo shop (capiConfigByShop[shopKey].accessToken).
  if (scoped.capiConfigByShop && typeof scoped.capiConfigByShop === 'object') {
    const next: any = {};
    for (const [k, v] of Object.entries(scoped.capiConfigByShop)) {
      const c: any = { ...(v as any) };
      delete c.accessToken;
      next[k] = c;
    }
    scoped.capiConfigByShop = next;
  }
}

/**
 * State trả cho client: dùng scopeState của src/store.ts (đúng quy tắc v37:
 * shop chỉ thấy đúng shop mình, Super Admin thấy tất cả), rồi tẩy
 * passwordHash khỏi mọi tài khoản bằng toPublicAccount.
 */
function stateForClient(account: any, shopKey: string | null): any {
  const visibleShopKey = isSuperAdmin(account) ? shopKey : account?.shopKey ?? shopKey;
  let scoped: any;
  if (store) {
    scoped = store.scopeState(state, account?.role ?? "staff", visibleShopKey);
  } else {
    scoped = state ?? {};
  }
  if (Array.isArray(scoped.accounts)) {
    scoped.accounts = scoped.accounts.map((a: any) =>
      auth ? auth.toPublicAccount(a) : (({ passwordHash, password_hash, ...rest }: any) => rest)(a),
    );
  }
  stripShopSecrets(scoped);
  scoped._meta = { shopKey: visibleShopKey, isSuperAdmin: isSuperAdmin(account), version: VERSION };
  return scoped;
}

const app = express();
app.use(cors());

// --- Webhook TikTok: PHẢI đăng ký TRƯỚC express.json (cần raw body để verify chữ ký) ---
app.post("/webhook/tiktok", express.raw({ type: "*/*", limit: "1mb" }), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body as Buffer;
    if (!actions || !store || !state || typeof actions.handleTikTokWebhook !== "function") {
      return res.status(503).json({ ok: false, error: "Webhook TikTok chưa sẵn sàng" });
    }
    const result = await actions.handleTikTokWebhook(state, {
      rawBody,
      authorization: req.header("authorization") ?? null,
      xTtsSignature: req.header("x-tts-signature") ?? null,
      xTtsTimestamp: req.header("x-tts-timestamp") ?? null,
    });
    if (!result?.ok) {
      // Chữ ký sai / shop lạ → 401, không ack (TikTok sẽ retry).
      return res.status(401).json({ ok: false, error: result?.error ?? "Webhook TikTok không hợp lệ." });
    }
    if (result.duplicate) return res.status(200).json({ ok: true, duplicate: true });
    const eventId = String(result.eventId ?? "");
    // Ack nhanh (< 3s theo yêu cầu TikTok), xử lý chạy nền rồi mới lưu state.
    res.status(200).json({ ok: true, eventId });
    setImmediate(async () => {
      try {
        if (typeof actions!.processStoredTikTokWebhookEvent === "function") {
          await actions!.processStoredTikTokWebhookEvent(state, eventId);
        }
        await store!.saveState(state);
      } catch (e) {
        console.error("[achatgo] xử lý webhook TikTok lỗi:", e);
      }
    });
  } catch (err) {
    console.error("[achatgo] webhook TikTok lỗi:", err);
    res.status(500).json({ ok: false, error: "Lỗi server" });
  }
});

// --- Webhook Shopee: PHẢI đăng ký TRƯỚC express.json (cần raw body để verify chữ ký) ---
app.post("/webhook/shopee", express.raw({ type: "*/*", limit: "1mb" }), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body as Buffer;
    if (!actions || !store || !state || typeof actions.handleShopeePush !== "function") {
      return res.status(503).json({ ok: false, error: "Webhook Shopee chưa sẵn sàng" });
    }
    const requestUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const result = await actions.handleShopeePush(state, {
      rawBody,
      callbackUrl: requestUrl,
      authorization: req.header("authorization") ?? null,
      xShopeeSignature: req.header("x-shopee-signature") ?? null,
    });
    if (!result?.ok) {
      // Chữ ký sai / shop lạ → 401, không ack (Shopee sẽ retry / có thể lấy lại qua get_lost_push_message).
      return res.status(401).json({ ok: false, error: result?.error ?? "Webhook Shopee không hợp lệ." });
    }
    if (result.duplicate) return res.status(200).json({ ok: true, duplicate: true });
    const eventId = String(result.eventId ?? "");
    // Ack nhanh, xử lý chạy nền rồi mới lưu state.
    res.status(200).json({ ok: true, eventId });
    setImmediate(async () => {
      try {
        if (typeof actions!.processStoredShopeePushEvent === "function") {
          await actions!.processStoredShopeePushEvent(state, eventId);
        }
        await store!.saveState(state);
      } catch (e) {
        console.error("[achatgo] xử lý webhook Shopee lỗi:", e);
      }
    });
  } catch (err) {
    console.error("[achatgo] webhook Shopee lỗi:", err);
    res.status(500).json({ ok: false, error: "Lỗi server" });
  }
});

// --- OAuth callback TikTok: đổi code lấy token rồi hiện trang kết quả ---
app.get("/auth/tiktok/callback", async (req: Request, res: Response) => {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6}h1{font-size:20px}.ok{color:#0a7d2c}.err{color:#c00}</style></head><body>${body}</body></html>`;
  const code = String(req.query.code ?? "");
  const stateParam = String(req.query.state ?? "");
  if (!code || !stateParam) {
    return res.status(400).send(page("Kết nối TikTok thất bại", '<h1 class="err">Thiếu mã ủy quyền</h1><p>TikTok không trả về code/state. Hãy bấm "Kết nối TikTok" lại trong app.</p>'));
  }
  if (!actions || !store || !state) {
    return res.status(503).send(page("Kết nối TikTok thất bại", '<h1 class="err">Server chưa sẵn sàng</h1><p>Thử lại sau vài giây.</p>'));
  }
  try {
    // Đổi state nonce lấy shopKey (chống CSRF, hết hạn 10 phút).
    const tiktok = (await import("./src/tiktok.js")) as { consumeTikTokAuthState: (s: string) => string | null };
    const shopKey = tiktok.consumeTikTokAuthState(stateParam);
    if (!shopKey) {
      return res.status(400).send(page("Kết nối TikTok thất bại", '<h1 class="err">Link ủy quyền đã hết hạn hoặc không hợp lệ</h1><p>State hết hạn sau 10 phút hoặc đã dùng rồi. Hãy bấm "Kết nối TikTok" lại trong app.</p>'));
    }
    const ctx = { account: { role: "super_admin", id: "tiktok-callback" }, shopKey, hostShopKey: null, version: VERSION };
    const result = await actions.handleAction(state, "exchangetiktokcode", { code, shopKey }, ctx);
    if (!result?.ok) {
      return res.status(400).send(page("Kết nối TikTok thất bại", `<h1 class="err">Không đổi được mã ủy quyền</h1><p>${esc(String(result?.error ?? "Lỗi không rõ."))}</p><p>Mã auth_code chỉ dùng được 1 lần trong 30 phút — bấm "Kết nối TikTok" lại trong app để lấy mã mới.</p>`));
    }
    await store.saveState(state);
    const shopName = result.shopName ? ` — ${esc(String(result.shopName))}` : "";
    res.send(page("Kết nối TikTok thành công", `<h1 class="ok">Đã kết nối TikTok Shop${shopName}</h1><p>Shop <b>${esc(shopKey)}</b> đã ủy quyền xong. Đơn hàng, sản phẩm, hoàn/trả và tài chính TikTok sẽ đồng bộ về app.</p><p>Đóng cửa sổ này và quay lại app.</p>`));
  } catch (err) {
    console.error("[achatgo] callback TikTok lỗi:", err);
    res.status(500).send(page("Kết nối TikTok thất bại", '<h1 class="err">Lỗi server</h1><p>Thử lại sau vài giây.</p>'));
  }
});

// --- OAuth callback Shopee: đổi code lấy token rồi hiện trang kết quả ---
// Shopee auth_partner KHÔNG trả state — callback chỉ có code + shop_id,
// nên shopKey lấy từ pending authorization (bấm "Kết nối Shopee" tạo,
// hết hạn 10 phút, 1 pending duy nhất).
app.get("/auth/shopee/callback", async (req: Request, res: Response) => {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6}h1{font-size:20px}.ok{color:#0a7d2c}.err{color:#c00}</style></head><body>${body}</body></html>`;
  const code = String(req.query.code ?? "");
  const shopId = String(req.query.shop_id ?? "");
  if (!code || !shopId) {
    return res.status(400).send(page("Kết nối Shopee thất bại", '<h1 class="err">Thiếu mã ủy quyền</h1><p>Shopee không trả về code/shop_id. Hãy bấm "Kết nối Shopee" lại trong app.</p>'));
  }
  if (!actions || !store || !state) {
    return res.status(503).send(page("Kết nối Shopee thất bại", '<h1 class="err">Server chưa sẵn sàng</h1><p>Thử lại sau vài giây.</p>'));
  }
  try {
    // Đổi pending authorization lấy shopKey (hết hạn 10 phút, dùng 1 lần).
    const shopee = (await import("./src/shopee.js")) as { consumeShopeeAuthState: () => { shopKey: string } | null };
    const pending = shopee.consumeShopeeAuthState();
    if (!pending) {
      return res.status(400).send(page("Kết nối Shopee thất bại", '<h1 class="err">Phiên kết nối đã hết hạn hoặc không hợp lệ</h1><p>Phiên kết nối hết hạn sau 10 phút hoặc đã có shop khác bấm kết nối trước. Hãy bấm "Kết nối Shopee" lại trong app.</p>'));
    }
    const shopKey = pending.shopKey;
    const ctx = { account: { role: "super_admin", id: "shopee-callback" }, shopKey, hostShopKey: null, version: VERSION };
    const result = await actions.handleAction(state, "exchangeshopeecode", { code, shopId, shopKey }, ctx);
    if (!result?.ok) {
      return res.status(400).send(page("Kết nối Shopee thất bại", `<h1 class="err">Không đổi được mã ủy quyền</h1><p>${esc(String(result?.error ?? "Lỗi không rõ."))}</p><p>Code chỉ dùng được 1 lần trong 10 phút — bấm "Kết nối Shopee" lại trong app để lấy mã mới.</p>`));
    }
    await store.saveState(state);
    const shopName = result.shopName ? ` — ${esc(String(result.shopName))}` : "";
    res.send(page("Kết nối Shopee thành công", `<h1 class="ok">Đã kết nối Shopee${shopName}</h1><p>Shop <b>${esc(shopKey)}</b> đã ủy quyền xong. Đơn hàng, sản phẩm, hoàn/trả và đối soát Shopee sẽ đồng bộ về app.</p><p>Lưu ý: tin nhắn khách Shopee vẫn trả lời tay trong Seller Center (Chat API đã đóng với app mới). SĐT/địa chỉ khách mặc định bị Shopee che.</p><p>Đóng cửa sổ này và quay lại app.</p>`));
  } catch (err) {
    console.error("[achatgo] callback Shopee lỗi:", err);
    res.status(500).send(page("Kết nối Shopee thất bại", '<h1 class="err">Lỗi server</h1><p>Thử lại sau vài giây.</p>'));
  }
});

app.use(express.json({ limit: "10mb" }));

// --- Health check (Render dùng để kiểm tra service còn sống) ---
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, version: VERSION });
});

// --- Bootstrap: client gọi sau khi đăng nhập để lấy state đã lọc theo shop ---
app.get("/api/bootstrap", (req: Request, res: Response) => {
  const account = authenticate(req);
  if (!account) return res.status(401).json({ ok: false, error: "Chưa đăng nhập" });
  res.json({ ok: true, data: stateForClient(account, shopKeyFromHost(req)) });
});

// --- API chung: mọi thao tác nghiệp vụ đi qua POST /api/action ---
app.post("/api/action", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, args } = req.body ?? {};
    if (!action || typeof action !== "string") {
      return res.status(400).json({ ok: false, error: "Thiếu tên action" });
    }

    // Đăng nhập chạy được ngay qua src/auth.ts, không chờ src/actions.ts.
    if (action === "loginaccount") {
      if (!auth || !state) {
        return res.status(501).json({ ok: false, error: "Chức năng chưa triển khai: src/auth.ts chưa có trong bản deploy này" });
      }
      const result = auth.loginAccount(state, String(args?.identifier ?? ""), String(args?.password ?? ""));
      if (!result.ok) return res.status(401).json({ ok: false, error: result.error });
      // Token tối giản = id tài khoản (xem authenticate()). Client gửi lại
      // token này trong header x-account-token ở mọi request sau.
      return res.json({ ok: true, data: { token: result.account.id, account: result.account } });
    }

    const account = authenticate(req);
    if (!account) return res.status(401).json({ ok: false, error: "Chưa đăng nhập" });
    if (!actions || !store || !state) {
      return res.status(501).json({
        ok: false,
        error: "Chức năng chưa triển khai: code server src/actions.ts chưa có trong bản deploy này",
      });
    }
    const hostShopKey = shopKeyFromHost(req);
    const effectiveShopKey = req.body?.shopKey ?? account.shopKey ?? hostShopKey ?? null;
    // Tài khoản shop chỉ được gọi trong shop của mình; Super Admin được mọi shop.
    if (!isSuperAdmin(account) && account.shopKey && effectiveShopKey && effectiveShopKey !== account.shopKey) {
      return res.status(403).json({ ok: false, error: "Không có quyền với shop này" });
    }
    const ctx = { account, shopKey: effectiveShopKey, hostShopKey, version: VERSION };
    const result = await actions.handleAction(state, action, args ?? {}, ctx);
    if (result?.ok && isWriteAction(action)) {
      await store.saveState(state);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- File tĩnh: SPA client ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Xử lý lỗi chung ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[achatgo] lỗi:", err);
  res.status(500).json({ ok: false, error: "Lỗi server, vui lòng thử lại" });
});

async function main(): Promise<void> {
  await loadServerModules();
  if (store) {
    state = await store.loadState();
    // Khởi tạo lần đầu: file dữ liệu chưa có tài khoản nào thì seed catalogue
    // + 4 shop + tài khoản Super Admin mặc định (xem src/seed.ts). Không có
    // bước này thì deploy mới không ai đăng nhập được (deadlock).
    if (!state.accounts || state.accounts.length === 0) {
      try {
        const seed = (await import("./src/seed.js")) as {
          seedInitialState: () => any;
          generatedAdminPassword?: string;
        };
        state = seed.seedInitialState();
        await store.saveState(state);
        console.log("[achatgo] đã seed dữ liệu khởi tạo lần đầu (4 shop, catalogue, Super Admin mặc định)");
        console.log("[achatgo] TÀI KHOẢN SUPER ADMIN LẦN ĐẦU: admin@achat.vn — MẬT KHẨU TẠM (chỉ hiện 1 lần ở log này, đổi ngay sau khi đăng nhập):", seed.generatedAdminPassword ?? "(không đọc được — đặt lại bằng setupsuperadmin)");
      } catch (err) {
        console.warn("[achatgo] không seed được dữ liệu khởi tạo:", (err as Error).message);
      }
    }
  } else {
    state = { accounts: [], shops: [], orders: [], products: [], customers: [], conversations: [], shippingRules: [] };
  }
  app.listen(PORT, () => {
    console.log(`[achatgo] ${VERSION} đang chạy trên cổng ${PORT}`);
  });
}

main();
