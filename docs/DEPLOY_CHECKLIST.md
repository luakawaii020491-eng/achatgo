# Checklist sau triển khai AChatGo (v38 standalone)

Chạy checklist này ngay sau mỗi lần deploy lên Render, theo đúng PDF hướng
dẫn vận hành. Đánh dấu ☐ → ☑ khi xong. Dừng lại và báo user nếu mục nào lỗi.

## 0. Chuẩn bị

- [ ] Ghi lại thời gian deploy + commit/branch đã deploy (`main`).
- [ ] **Lấy mật khẩu tạm Super Admin trong Logs của service** (chỉ in 1 lần lúc seed đầu tiên), đăng nhập `admin@achat.vn` rồi đổi mật khẩu ngay.
- [ ] **Sao lưu DB trước khi kiểm tra**: xuất file JSON (`DATA_FILE`) hoặc
      dump Postgres ra file, lưu kèm ngày giờ. Không kiểm tra trên dữ liệu
      thật nếu chưa sao lưu.

## 1. Meta — redirect URI + đăng nhập lại

- [ ] Cập nhật **redirect URI trong Meta App** thành
      `https://<tenshop>.achat.vn/auth/meta/callback` cho từng shop
      (Meta for Developers → Đăng nhập Facebook → Valid OAuth Redirect URIs).
- [ ] Cập nhật cùng URI đó **trong app** (biến `META_REDIRECT_URI` trên
      Render, khớp đúng tên miền riêng của shop).
- [ ] **Đăng nhập Facebook lại** bằng nút "Kết nối tài khoản Meta" trong app,
      chọn đúng page của shop, tick đủ 6 quyền: `pages_show_list`,
      `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`,
      `instagram_basic`, `instagram_manage_messages`.
      - Lưu ý (09-11-2026): ô "KẾT NỐI CHO SHOP NÀO?" chỉ hiện tên shop của
        chính tài khoản đang đăng nhập, tự chọn sẵn; Super Admin vẫn thấy đủ
        danh sách.
- [ ] Kiểm tra **page** đã gán đúng shop (không sang shop khác).
- [ ] Kiểm tra **hội thoại** inbox đổ về đúng shop, tin mới nhất hiện đúng.

## 2. Pixel — luồng lấy Pixel

- [ ] Bấm "Kết nối Facebook để lấy Pixel" trong app (xin thêm quyền
      `ads_management` / `business_management`).
- [ ] Kiểm tra danh sách pixel/tài khoản quảng cáo liệt kê được; chọn đúng
      1 pixel cho mỗi shop (mỗi shop báo về đúng pixel của shop đó).
- [ ] Nếu danh sách trống: kiểm tra `/me/permissions` — token phải có
      `ads_management`/`ads_read`; nếu thiếu, đăng nhập lại và cấp đủ quyền.
      Nhập tay Pixel ID + token vẫn dùng được làm dự phòng.
- [ ] Kiểm tra **báo đơn về Facebook (CAPI)**: tạo 1 đơn thử, gửi kèm
      `test_event_code`, xác nhận Events Manager nhận được sự kiện Purchase
      (kèm SĐT đã băm + mã đơn + tổng COD).

## 3. Hãng vận chuyển

- [ ] **Đăng ký webhook Best với địa chỉ mới** (`https://<tenshop>.achat.vn/...`
      theo hướng dẫn của Best) để trạng thái giao hàng cập nhật về app.
- [ ] Tạo **đơn thử** + tính phí ship theo quy tắc của shop, đối chiếu với
      bảng giá đã kiểm chứng (quai ngang/sục 3 phân/rọ: 80k/100k/150k;
      đế cao 7 phân: 100k/149k/224k; sục khoét lỗ: 90k/130k).
- [ ] Đẩy thử từng hãng đã nối thật: **GHN, GHTK, Viettel Post, Best** —
      mỗi hãng ít nhất 1 đơn, xác nhận trả về mã vận đơn thật.
- [ ] **KHÔNG đẩy J&T** — J&T chưa nối thật (đang chờ duyệt developer,
      chưa có apiAccount/privateKey).

## 4. In ấn

- [ ] In thử **nhãn** và **hóa đơn** từ đơn thử.
- [ ] Kiểm tra khối NGƯỜI GỬI ghi **tên shop của đơn đó** (vd đơn Xinh ghi
      "DÉP XINH") + địa chỉ điểm lấy hàng.
- [ ] Kiểm tra **SĐT che 6 số đầu, chỉ hiện 4 số cuối** (vd `******8008`) —
      cả SĐT người gửi và SĐT người nhận.
- [ ] Nhãn thật do hãng trả qua API giữ nguyên định dạng hãng, không vẽ lại
      mẫu chung.

## 5. Phân quyền shop — kiểm tra cách ly dữ liệu

- [ ] Mở **`lua123.achat.vn` ở chế độ ẩn danh**, đăng nhập tài khoản lua123:
      chỉ thấy dữ liệu shop lua123 — **trống hoàn toàn** (0 sản phẩm, 0 đơn,
      0 khách, 0 quy tắc phí ship).
- [ ] Xác nhận tài khoản lua123 **không thấy** dữ liệu DÉP XINH / Bé Đan /
      Dép Hana.
- [ ] Xác nhận Super Admin vẫn thấy dữ liệu cũ (chỉ để test, không xóa).
- [ ] Kiểm tra hạn dùng thử lua123: hết **16/11/2026**, giới hạn 1 page /
      1 nhân viên.

## 6. Vận hành

- [ ] Cho **nhân viên vào thử**: đăng nhập, tạo đơn, đẩy hãng, in nhãn —
      xác nhận đúng quyền của nhân viên (không thấy Super Admin, không thấy
      shop khác).
- [ ] Kiểm tra Trợ lý AI trả lời được câu hỏi về đơn/sản phẩm/phí ship
      của đúng shop.
- [ ] **Sao lưu DB sau khi kiểm tra xong** (đã có dữ liệu thử + tài khoản mới).
- [ ] Ghi lại kết quả từng mục (đạt/lỗi + ảnh chụp màn hình nếu lỗi) và báo
      user trước khi mở cho shop dùng thật.

## 7. TikTok Shop — app chung + callback + webhook + ủy quyền

- [ ] Đăng ký **1 Public app** trong TikTok Shop Partner Center
      (`partner.tiktokshop.com`, cổng Global) — cần giấy tờ doanh nghiệp +
      chờ TikTok duyệt. Đăng ký **Redirect URI**
      `https://achat.vn/auth/tiktok/callback` và **Webhook URL**
      `https://achat.vn/webhook/tiktok` trong Partner Center
      (App & Service → app chung → URLs). Bật **tất cả scope** trước khi shop
      ủy quyền: seller.authorization.info, seller.shop.info, seller.order.info,
      seller.product.basic, seller.product.write, seller.fulfillment.basic,
      seller.logistics.basic, seller.return_refund.basic, seller.finance.info,
      seller.promotion.info. Scope nhắn tin khách (Customer Service) TikTok
      cấp theo yêu cầu — xin riêng nếu cần.
- [ ] Nhập **App Key / App Secret / Service ID của app chung 1 lần duy nhất**
      trong app (đăng nhập Super Admin → màn Kênh bán hàng → App TikTok
      chung). Xác nhận appKey chỉ hiện dạng đã che, App Secret không hiện lại.
- [ ] Bấm **"Kết nối TikTok"** trong app (tài khoản shop), ủy quyền trên trang
      TikTok, xác nhận trang callback báo thành công và màn Kênh bán hàng hiện
      "Đã kết nối" + tên shop TikTok. (Shop không nhập app_key/app_secret/
      service_id — chỉ bấm kết nối.)
- [ ] Bấm **"Đăng ký webhook"** trong app, xác nhận đủ 7 loại event đăng ký
      thành công (ORDER_STATUS_CHANGE, ORDER_STATUS_UPDATE, PACKAGE_UPDATE,
      RECIPIENT_ADDRESS_UPDATE, PRODUCT_STATUS_CHANGE,
      SELLER_DEAUTHORIZATION, NEW_MESSAGE).
- [ ] **Đồng bộ đơn** thử: tạo 1 đơn thử trên TikTok, bấm "Đồng bộ đơn",
      xác nhận đơn về app đúng mã đơn sàn, tổng tiền sàn, trạng thái đã map
      (không báo Purchase về Facebook — đơn sàn không đi CAPI).
- [ ] **Đồng bộ sản phẩm** thử: xác nhận SKU map đúng theo seller_sku,
      đẩy thử tồn kho + giá 1 SKU lên TikTok rồi kiểm tra lại trong
      Seller Center.
- [ ] **Đồng bộ hoàn/trả + tài chính** thử: xác nhận phiếu trả được tạo
      trong app và sao kê đối soát được với đơn TikTok.
- [ ] Kiểm tra **GET /api/bootstrap không lộ secret**: tài khoản shop
      không thấy `tiktokPlatform.appSecret`, `tiktok.appSecret`,
      `tiktok.accessToken`, `tiktok.refreshToken`, `meta.appSecret`,
      `capiConfigByShop.*.accessToken` (appKey chỉ hiện dạng đã che — kể cả
      với Super Admin). Tài khoản shop gọi `gettiktokplatformconfig` phải bị
      từ chối (chỉ Super Admin).
- [ ] **Chưa có thông tin thật thì bỏ qua mục này** — cần app chung đã đăng
      ký + duyệt ở Partner Center, nhập 1 lần vào Super Admin, + URL công
      khai (deploy Render + DNS achat.vn) mới kiểm chứng live được.

## 8. Shopee — app ISV chung + callback + push + ủy quyền

- [ ] Đăng ký **1 app Third-Party Partner (ISV)** tại Shopee Open Platform
      (`open.shopee.com`) — cần giấy tờ doanh nghiệp + chờ Shopee duyệt
      ~10 ngày làm việc. Đăng ký **Redirect URI**
      `https://achat.vn/auth/shopee/callback` và **Webhook URL**
      `https://achat.vn/webhook/shopee` trong console (mục Push Mechanism /
      URLs). Chọn **đủ API trước khi tạo app** (loại app cố định, không thêm
      quyền sau): Product, Order, Logistics, Payment, Returns. **KHÔNG
      chọn Customer Service** (Chat API đã đóng với app mới từ 18/11/2024).
- [ ] Nhập **Partner ID / Partner Key của app chung 1 lần duy nhất**
      trong app (đăng nhập Super Admin → màn Kênh bán hàng → App Shopee
      chung). Xác nhận partnerId chỉ hiện dạng đã che, Partner Key không
      hiện lại. Ghi lại ngày tạo key — **key hết hạn sau 180 ngày**.
- [ ] Bấm **"Kết nối Shopee"** trong app (tài khoản shop), ủy quyền trên
      trang Shopee (chọn thời hạn 7/30/90/180/365 ngày), xác nhận trang
      callback báo thành công và màn Kênh bán hàng hiện "Đã kết nối" + tên
      shop Shopee. (Shop không nhập partner_id/partner_key — chỉ bấm kết
      nối. Mỗi lần chỉ 1 shop bấm kết nối vì Shopee không trả state.)
- [ ] **Đồng bộ đơn** thử: tạo 1 đơn thử trên Shopee, bấm "Đồng bộ đơn",
      xác nhận đơn về app đúng order_sn, tổng tiền sàn, trạng thái đã map
      (không báo Purchase về Facebook — đơn sàn không đi CAPI; đơn Shopee
      đi logistics Shopee, không đẩy sang GHN/GHTK/Best).
- [ ] **Đồng bộ sản phẩm** thử: xác nhận SKU map đúng theo model_sku,
      đẩy thử tồn kho + giá 1 SKU lên Shopee rồi kiểm tra lại trong
      Seller Center.
- [ ] **Đồng bộ hoàn/trả + đối soát** thử: xác nhận phiếu trả được tạo
      trong app và escrow đối soát được với đơn Shopee.
- [ ] Kiểm tra **push webhook**: tạo đơn thử trên Shopee, xác nhận event
      push code 3 về app (màn Kênh bán hàng → Push webhook gần đây) và đơn
      được tạo/cập nhật. Nếu mất push, dùng action `getshopeelostpush`
      để khôi phục.
- [ ] Kiểm tra **GET /api/bootstrap không lộ secret**: tài khoản shop
      không thấy `shopeePlatform.partnerKey`, `shopee.accessToken`,
      `shopee.refreshToken` (partnerId chỉ hiện dạng đã che — kể cả
      với Super Admin). Tài khoản shop gọi `getshopeeplatformconfig` phải bị
      từ chối (chỉ Super Admin).
- [ ] **Chưa có thông tin thật thì bỏ qua mục này** — cần app ISV đã đăng
      ký + duyệt ở open.shopee.com, nhập 1 lần vào Super Admin, + URL công
      khai (deploy Render + DNS achat.vn) mới kiểm chứng live được.
