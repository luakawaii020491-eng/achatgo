// Test: SUPER_ADMIN_PASSWORD cố định vs mật khẩu tạm ngẫu nhiên.
// Chạy: npx tsx scripts/test-seed-admin-password.ts  (exit 0 = PASS)
import * as seed from '../src/seed.js';
import { hashPassword, verifyPassword } from '../src/auth.js';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`);
  if (!cond) failures++;
}

const auth = { verifyPassword, hashPassword };

// 1. Env var đặt -> seed dùng đúng mật khẩu đó, mustChangePassword = false.
process.env.SUPER_ADMIN_PASSWORD = 'Admin-Test123';
let r = seed.resolveAdminPassword();
check('env đặt: resolveAdminPassword fixed=true, đúng giá trị', r.fixed === true && r.password === 'Admin-Test123');
let st = seed.seedInitialState();
let sa = st.accounts.find((a) => a.role === 'super_admin')!;
check('env đặt: seed có SA admin@achat.vn', sa?.email === 'admin@achat.vn');
check('env đặt: mustChangePassword=false', sa?.mustChangePassword === false);
check('env đặt: verifyPassword đúng mật khẩu env', verifyPassword('Admin-Test123', sa.passwordHash));
check('env đặt: generatedAdminPassword = mật khẩu env', seed.generatedAdminPassword === 'Admin-Test123');

// 2. Env var không đặt -> hành vi ngẫu nhiên cũ không đổi.
delete process.env.SUPER_ADMIN_PASSWORD;
r = seed.resolveAdminPassword();
check('không env: resolveAdminPassword fixed=false, dạng Admin-...', r.fixed === false && r.password.startsWith('Admin-'));
st = seed.seedInitialState();
sa = st.accounts.find((a) => a.role === 'super_admin')!;
check('không env: mustChangePassword=true', sa?.mustChangePassword === true);
check('không env: verifyPassword đúng mật khẩu tạm vừa sinh', verifyPassword(seed.generatedAdminPassword, sa.passwordHash));

// 3. Env var quá ngắn -> throw (fail loudly).
process.env.SUPER_ADMIN_PASSWORD = 'abc';
let threw = false;
try { seed.resolveAdminPassword(); } catch { threw = true; }
check('env ngắn: resolveAdminPassword throw', threw);
threw = false;
try { seed.seedInitialState(); } catch { threw = true; }
check('env ngắn: seedInitialState throw', threw);
threw = false;
try { seed.reconcileFixedAdminPassword(st, auth); } catch { threw = true; }
check('env ngắn: reconcileFixedAdminPassword throw', threw);

// 4. Reconcile: state seed ngẫu nhiên (flag true) + env đặt -> sửa thành cố định.
delete process.env.SUPER_ADMIN_PASSWORD;
st = seed.seedInitialState();
sa = st.accounts.find((a) => a.role === 'super_admin')!;
const oldHash = sa.passwordHash;
check('reconcile chuẩn bị: flag true, mật khẩu tạm verify được', sa.mustChangePassword === true && verifyPassword(seed.generatedAdminPassword, sa.passwordHash));
process.env.SUPER_ADMIN_PASSWORD = 'Admin-Test123';
check('reconcile: lần 1 trả true (có thay đổi)', seed.reconcileFixedAdminPassword(st, auth) === true);
sa = st.accounts.find((a) => a.role === 'super_admin')!;
check('reconcile: flag=false, hash đổi, verify mật khẩu env được', sa.mustChangePassword === false && sa.passwordHash !== oldHash && verifyPassword('Admin-Test123', sa.passwordHash));
check('reconcile: lần 2 trả false (đã đúng, không ghi lại)', seed.reconcileFixedAdminPassword(st, auth) === false);

// 5. Reconcile không có env -> false, không động vào state.
delete process.env.SUPER_ADMIN_PASSWORD;
st = seed.seedInitialState();
check('reconcile không env: trả false', seed.reconcileFixedAdminPassword(st, auth) === false);

delete process.env.SUPER_ADMIN_PASSWORD;
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
