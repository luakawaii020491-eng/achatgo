// CompanyFooter — khối chân trang thông tin đơn vị phát triển phần mềm,
// dùng chung cho màn đăng nhập, cuối nội dung app, màn hình chặn truy cập
// và cuối sidebar. Nội dung thống nhất theo yêu cầu chủ shop (2026-11-11):
// "Phần mềm được phát triển bởi CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ HOÀNG HƯNG
// VINA — Địa chỉ: Thôn Phúc Hưng, Xã Ninh Giang, Tỉnh Ninh Bình — ĐKKD:
// 0601235870 — Mã số doanh nghiệp", kèm tổng đài hỗ trợ 0916636785 và
// dòng bản quyền © 2026.
import React from 'react';
import { Building2 } from 'lucide-react';

export const COMPANY_NAME = 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ HOÀNG HƯNG VINA';
export const COMPANY_ADDRESS = 'Thôn Phúc Hưng, Xã Ninh Giang, Tỉnh Ninh Bình';
export const COMPANY_DKKD = '0601235870';
export const COMPANY_HOTLINE = '0916636785';

/** Toàn bộ thông tin công ty dạng 1 dòng (dùng cho chú thích/tooltip). */
export const COMPANY_FULL_TEXT =
  `Phần mềm được phát triển bởi ${COMPANY_NAME} — Địa chỉ: ${COMPANY_ADDRESS} — ` +
  `ĐKKD: ${COMPANY_DKKD} — Mã số doanh nghiệp. Tổng đài hỗ trợ: ${COMPANY_HOTLINE}. © 2026 AChatGo`;

/** Khối đầy đủ: tên công ty + địa chỉ + ĐKKD + tổng đài + bản quyền. */
export function CompanyFooter() {
  return (
    <footer className="company-footer">
      <div className="cf-label">Phần mềm được phát triển bởi</div>
      <div className="cf-name">{COMPANY_NAME}</div>
      <div className="cf-line">Địa chỉ: {COMPANY_ADDRESS}</div>
      <div className="cf-line">
        ĐKKD: <span className="mono">{COMPANY_DKKD}</span> — Mã số doanh nghiệp
      </div>
      <div className="cf-line">
        Tổng đài hỗ trợ: <span className="mono">{COMPANY_HOTLINE}</span>
      </div>
      <div className="cf-copy">© 2026 AChatGo</div>
    </footer>
  );
}

/** Bản thu gọn cho cuối sidebar khi mở rộng: tên công ty + ĐKKD.
 * Khi sidebar thu gọn chỉ hiện biểu tượng, rê chuột vào thấy đầy đủ
 * thông tin công ty (title). */
export function CompanyFooterCompact() {
  return (
    <div className="sidebar-company" title={COMPANY_FULL_TEXT}>
      <Building2 size={16} className="company-icon" />
      <span className="company-name">{COMPANY_NAME}</span>
      <span className="company-dkkd">ĐKKD: {COMPANY_DKKD}</span>
    </div>
  );
}
