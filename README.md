# AChatGo — bản standalone (v38)

App quản lý bán hàng cho các shop dép: đơn hàng, sản phẩm, khách hàng, hội
thoại fanpage, vận chuyển (GHN / GHTK / Viettel Post / Best), phí ship theo
loại sản phẩm, Trợ lý AI và Super Admin quản lý nhiều shop.

Tên hiện tại của app là **AChatGo** (tên miền **achat.vn** — đã mua ngày
09-11-2026). Tên hiển thị Achat hay AChatGo đang chờ user chốt; khi chốt xong
chỉ cần đổi chuỗi hiển thị, không đổi tên miền hay dữ liệu.

Giao diện theo phong cách Achat cũ: sidebar navy `#182538`, font Be Vietnam
Pro + JetBrains Mono, accent `#0088FF`, header có chọn shop + pill trạng thái
+ nút Tạo đơn.

## Shop và sản phẩm đang chạy (đã kiểm chứng 09-11-2026)

| Shop | Gói | Ghi chú |
|---|---|---|
| lua123 | Dùng thử 7 ngày, hết 16/11/2026, 1 page / 1 nhân viên | Shop mới, bắt đầu trống hoàn toàn |
| DÉP XINH | Pro | Dép quai ngang |
| Shop Bé Đan | Pro | Sục 3 phân, rọ đan lưới |
| Dép Hana | Pro | Sục khoét lỗ |

Gói: **Dùng thử 1 page / 1 nhân viên, 0đ**; **Cơ bản 5 page / 5 nhân viên**;
**Nâng cao 10 page / 10 nhân viên**; mua thêm **20.000đ/tháng/1 page** và
**20.000đ/tháng/1 nhân viên**. Tổng đài: **0916636785**.

Sản phẩm (giá lên đơn — 1 đôi / 2 đôi / 3 đôi, miễn ship từ 2 đôi):

- **DÉP QUAI NGANG 50k** — Đen/Nâu/Kem, size 36–39: 80k / 100k / 150k
- **DÉP ĐẾ CAO 7 PHÂN 75k** — Đen/Xám/Trắng, size 36-37 / 38-39: 1 đôi 100k, 2 đôi 149k, 3 đôi 224k
- **SỤC 3 PHÂN 50k**: 80k / 100k / 150k
- **DÉP RỌ ĐAN LƯỚI 50k**: 80k / 100k / 150k
- **SỤC KHOÉT LỖ 65k**: 1 đôi 90k, 2 đôi 130k miễn ship

Quy tắc quan trọng (v37): shop mới trống hoàn toàn; dữ liệu cũ chỉ Super
Admin thấy; tài khoản shop chỉ thấy dữ liệu shop mình; tên miền riêng dạng
`tenshop.achat.vn`.

## Chạy local

```bash
npm install
cp .env.example .env   # điền giá trị thật, xem ghi chú trong file
npm run dev            # chạy bằng tsx, mặc định cổng 10000 (đổi bằng PORT)
```

Build và chạy bản production local:

```bash
npm run build
npm start
```

Kiểm tra: mở `http://localhost:10000/health` phải trả
`{"ok":true,"version":"v38-standalone"}`.

## Deploy lên Render

1. Đẩy repo này lên GitHub (branch `main`).
2. Render → New → Web Service → chọn repo → Render tự đọc `render.yaml`
   (runtime node, region Singapore, plan free, build
   `npm install --legacy-peer-deps && npm run build`, start `npx tsx server.ts`).
3. Điền biến môi trường trong Render (theo `.env.example`): ít nhất
   `SESSION_SECRET`; các token hãng/Pixel/Meta khi đã có.
4. Gắn custom domain: `achat.vn` + `*.achat.vn` (Render → Settings →
   Custom Domains) rồi trỏ DNS 2 bản ghi về Render; chờ SSL cấp xong.
5. Chạy checklist sau triển khai: xem `docs/DEPLOY_CHECKLIST.md`.

## TikTok Shop (kênh bán hàng)

App đã nối TikTok Shop Open API (phiên bản 202309) theo **mô hình Achat — 1 app
chung cho cả nền tảng AChatGo** (đổi 2026-11-10): Super Admin đăng ký **1 Public
app duy nhất** trong TikTok Shop Partner Center, nhập app_key/app_secret/
service_id **1 lần** trong app (màn Kênh bán hàng → App TikTok chung, chỉ
Super Admin thấy). Các shop **không tự đăng ký app riêng** — mỗi shop chỉ bấm
"Kết nối TikTok" rồi ủy quyền tài khoản seller của mình (shop ID). App Secret
không bao giờ hiện lại sau khi lưu; đổi App Key/Service ID sẽ xóa token ủy
quyền của mọi shop (các shop phải kết nối lại).

- **Đăng ký app chung:** TikTok Shop Partner Center (`partner.tiktokshop.com`,
  cổng Global) → App & Service → tạo app (loại Public app — cần giấy tờ doanh
  nghiệp + chờ TikTok duyệt). Đăng ký trước **Redirect URI**
  `https://achat.vn/auth/tiktok/callback` và **Webhook URL**
  `https://achat.vn/webhook/tiktok` trong Partner Center (mục URLs của app).
  Bật **tất cả scope** trước khi shop ủy quyền (thêm scope sau bắt mọi seller
  ủy quyền lại toàn bộ): seller.authorization.info, seller.shop.info,
  seller.order.info, seller.product.basic, seller.product.write,
  seller.fulfillment.basic, seller.logistics.basic, seller.return_refund.basic,
  seller.finance.info, seller.promotion.info. Scope nhắn tin khách (Customer
  Service) TikTok cấp theo yêu cầu — app chỉ gửi tin khi scope đã được cấp.
- **Kết nối (từng shop):** bấm "Kết nối TikTok" → ủy quyền trên trang TikTok
  → callback đổi code lấy access token (7 ngày, tự refresh) + shop_cipher.
- **Đồng bộ:** đơn hàng (dedupe theo mã đơn TikTok, tổng tiền sàn làm chuẩn,
  không báo Purchase về Facebook), sản phẩm + tồn kho 2 chiều (map SKU nội bộ
  ↔ product_id/sku_id, tự map theo seller_sku trùng SKU), hoàn/trả/hủy
  (tạo phiếu trả trong app, đơn hoàn xong → trạng thái hoàn hàng), tài chính
  (sao kê + giao dịch + rút tiền; Payments API không dùng được ở Đông Nam Á
  nên đối soát bằng sao kê).
- **Webhook:** `POST /webhook/tiktok` — verify chữ ký HMAC-SHA256, ack 200
  ngay (< 3s), dedupe theo hash body, xử lý nền. Poll dự phòng: action
  `tiktokpoll` (cron ~5 phút, refresh token + đơn + hoàn/trả).
- **Chưa kiểm chứng live:** chưa có app chung thật (cần đăng ký Public app
  ở Partner Center + chờ TikTok duyệt) và chưa có URL công khai (cần deploy
  lên Render + DNS achat.vn trước). Test hiện tại chỉ bằng mock
  (xem `scripts/test-tiktok.ts`).

## Shopee (kênh bán hàng)

App đã nối Shopee Open Platform API v2 theo **mô hình Achat — 1 app ISV
(Third-Party Partner) chung cho cả nền tảng AChatGo** (xong 2026-11-10, cùng
quy mô với tích hợp TikTok): Super Admin đăng ký **1 app duy nhất** tại
`open.shopee.com`, nhập partner_id/partner_key **1 lần** trong app (màn Kênh
bán hàng → App Shopee chung, chỉ Super Admin thấy). Các shop **không tự đăng
ký app riêng** — mỗi shop chỉ bấm "Kết nối Shopee" rồi ủy quyền tài khoản
seller của mình (shop ID). Partner Key không bao giờ hiện lại sau khi lưu;
đổi Partner ID sẽ xóa token ủy quyền của mọi shop (các shop phải kết nối lại).

- **Đăng ký app chung:** Shopee Open Platform (`open.shopee.com`) → tạo app
  Third-Party Partner (cần giấy tờ doanh nghiệp + chờ Shopee duyệt ~10 ngày
  làm việc). Đăng ký trước **Redirect URI**
  `https://achat.vn/auth/shopee/callback` và **Webhook URL**
  `https://achat.vn/webhook/shopee` trong console (mục Push Mechanism/URLs
  của app). Chọn **đủ API trước khi tạo app** (loại app cố định, không thêm
  quyền sau): Product, Order, Logistics, Payment, Returns. **KHÔNG chọn
  Customer Service — Shopee đóng Chat API với app bên thứ 3 mới từ
  18/11/2024**, tin nhắn khách Shopee trả lời tay trong Seller Center.
- **Kết nối (từng shop):** bấm "Kết nối Shopee" → ủy quyền trên trang
  Shopee (seller chọn thời hạn 7/30/90/180/365 ngày) → callback đổi code
  (10 phút, dùng 1 lần) lấy access token (4h, tự refresh) + refresh token
  (30 ngày, xoay vòng). Ủy quyền tối đa 1 năm; Shopee gửi push code 12 bảy
  ngày trước khi hết hạn. **Lưu ý:** Shopee không hỗ trợ tham số state trên
  link ủy quyền nên mỗi lần chỉ 1 shop bấm kết nối (pending 10 phút) — bấm
  tiếp khi đang có pending khác sẽ bị từ chối để tránh gán nhầm shop.
- **Đồng bộ:** đơn hàng (dedupe theo order_sn, tổng tiền sàn làm chuẩn,
  map 9 trạng thái Shopee sang workflow 8 bước, không báo Purchase về
  Facebook), sản phẩm + tồn kho 2 chiều (map SKU nội bộ ↔ item_id/model_id,
  tự map theo model_sku/item_sku trùng SKU), hoàn/trả (tạo phiếu trả trong
  app, đơn hoàn xong → trạng thái hoàn hàng), tài chính (đối soát escrow
  qua get_escrow_detail + sao kê payout — tiền sàn về qua escrow, KHÔNG
  phải COD), logistics (mã vận đơn + lịch sử giao hàng của Shopee).
- **Webhook (push):** `POST /webhook/shopee` — verify chữ ký HMAC-SHA256
  (Authorization = HMAC(partner_key, callbackUrl + "|" + raw body)), ack
  200 ngay, dedupe theo hash body, xử lý nền. Push code: 1 shop authorized,
  2 shop deauthorized, 3 order status update, 4 tracking number update,
  10 buyer message, 12 authorization expiry. Khôi phục push mất qua
  get_lost_push_message. Poll dự phòng: action `shopeepoll` (cron ~5 phút,
  đơn + hoàn/trả, kèm tài chính khi cần).
- **Giới hạn (không workaround):** SĐT/địa chỉ khách mặc định bị che
  (muốn lấy thật phải xin quyền sensitive-data trong console); đơn Shopee
  đi logistics của Shopee — **KHÔNG** đẩy sang GHN/GHTK/Best; **KHÔNG** nhắn
  tin khách qua app. Partner Key hết hạn sau 180 ngày — app nhắc Super
  Admin reset khi key gần 180 ngày tuổi.
- **Chưa kiểm chứng live:** chưa có app ISV thật (cần đăng ký tại
  open.shopee.com + chờ Shopee duyệt ~10 ngày) và chưa có URL công khai
  (cần deploy lên Render + DNS achat.vn trước). Test hiện tại chỉ bằng mock
  (xem `scripts/test-shopee.ts` — 31 test).

## LƯU Ý QUAN TRỌNG

1. **Bản standalone này tái tạo từ bản artifact v38; từ v39 client là bản
   port đầy đủ giao diện artifact sang Vite/React** (`client/`, build ra
   `public/`): sidebar navy 22 view, header chọn shop + pill trạng thái +
   nút Tạo đơn, Tạo đơn toàn màn hình kiểu Sapo (F1/F8/F6), hội thoại
   3 cột, dashboard, đơn/sản phẩm/khách/bình luận/livestream/marketing/
   sổ quỹ/trả hàng/kho/báo cáo/kênh/vận chuyển/phí ship/AI/đánh giá/cài
   đặt/nhân viên/Super Admin. Adapter API dịch sang POST /api/action +
   GET /api/bootstrap với header x-account-token. Backend ~170 action
   giữ nguyên hành vi (xem `src/`).
2. **KHÔNG kèm dữ liệu khách hàng thật** — không SĐT, địa chỉ, tên khách, hội
   thoại nào. Dữ liệu thật đang ở trong artifact Muse. Khi lên Render phải
   tạo shop / tài khoản / sản phẩm mới hoặc nhập lại; tài khoản cũ phải đặt
   lại mật khẩu (hash mật khẩu không xuất được).
3. **J&T chưa nối thật** — chứng thực nhà phát triển đã nộp, đang chờ duyệt
   1–3 ngày làm việc mới cấp apiAccount/privateKey. Không đẩy đơn qua J&T
   cho tới khi có thông tin này.
4. **Chi phí Render chỉ khi user nâng:** Starter ~7 USD/tháng + Postgres
   ~6 USD/tháng. Plan free mặc định; disk free tier có thể không giữ dữ liệu
   khi deploy lại — dữ liệu thật nên dùng Postgres (xem `render.yaml`, phần
   database đang để dạng comment, chỉ bật khi user duyệt).
5. **Xác thực tối giản:** server xác thực bằng token = id tài khoản qua header
   `x-account-token` (xem ghi chú trong `server.ts`). Cần tăng cường (session
   có hạn, chống brute-force, rate-limit) trước khi mở cho shop lạ.
6. **Đăng nhập lần đầu:** lần chạy đầu tiên server tự seed 4 shop + catalogue
   và tạo tài khoản Super Admin `admin@achat.vn` với **mật khẩu tạm sinh ngẫu
   nhiên, chỉ in 1 lần trong log của Render** — mở Logs của service để lấy rồi
   đổi ngay sau khi đăng nhập (tài khoản có `mustChangePassword: true`). Không
   có mật khẩu mặc định ghi cứng trong repo.
7. **Tình trạng thư mục `src/` (kiểm tra 09-11-2026, bản v38):** đầy đủ
   `src/types.ts`, `src/store.ts` (loadState/saveState/createEmptyState/
   scopeState — đều **đồng bộ**, không Promise), `src/auth.ts`
   (loginAccount bằng bcrypt, toPublicAccount), `src/pricing.ts`
   (computeShipFee/computeOrderTotals/codTotalFor), `src/seed.ts`
   (seedInitialState v38, không dữ liệu thật), `src/actions.ts`
   (dispatcher `handleAction` đủ 170 action v38, gồm 22 action TikTok Shop
   + 19 action Shopee), `src/shopee.ts` (Shopee Open Platform API v2 — app
   ISV chung), `src/carriers.ts`
   (GHN/GHTK/VTP/Best + J&T trả `UNSUPPORTED_PUSH`), `src/capi.ts` (CAPI),
   `src/meta.ts` (Graph API / OAuth / Messenger).

## Cấu trúc

```
package.json  tsconfig.json  render.yaml  .env.example  .gitignore
server.ts            # entry Express: tĩnh public/ + POST /api/action + /health + /api/bootstrap
public/              # client SPA đã build (index.html + assets/ — sinh bởi `npm run build`)
client/              # mã nguồn client Vite/React (api.ts, App.tsx, views/, theme.css)
vite.config.ts       # build client ra public/
src/                 # logic nghiệp vụ (agent khác viết — xem mục 6 ở trên)
docs/DEPLOY_CHECKLIST.md
```
