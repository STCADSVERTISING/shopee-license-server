/**
 * ShopFlow Automate Pro — เซิร์ฟเวอร์ตรวจสอบลิขสิทธิ์ออนไลน์ (Online License Server)
 * พัฒนาด้วย Node.js + Express (ทำงานร่วมกับระบบฐานข้อมูลไฟล์จดบันทึก database.json เพื่อประหยัดทรัพยากร)
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, 'database.json');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'ShopFlowAdminSecretKey2026!!!'; // รหัสผ่านความปลอดภัยในการเจนคีย์

// เปิดใช้งาน CORS และการอ่าน Body แบบ JSON
app.use(cors());
app.use(express.json());

/**
 * ฟังก์ชันอ่านและเขียนฐานข้อมูลใบอนุญาต
 */
let dbMemory = { keys: [] };

// โหลดข้อมูลใบอนุญาตจาก Local หรือ GitHub Gist บนระบบคลาวด์
async function initDb() {
  const GIST_ID = process.env.GITHUB_GIST_ID;
  const GIST_TOKEN = process.env.GITHUB_TOKEN;

  if (GIST_ID && GIST_TOKEN) {
    console.log('📡 [Cloud DB] กำลังเชื่อมต่อและโหลดข้อมูลคีย์จาก GitHub Gist...');
    try {
      const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: {
          'Authorization': `token ${GIST_TOKEN}`,
          'User-Agent': 'ShopFlow-License-Server'
        }
      });
      if (response.ok) {
        const gistData = await response.json();
        const content = gistData.files['database.json'].content;
        dbMemory = JSON.parse(content);
        console.log(`🟢 [Cloud DB] โหลดคีย์สำเร็จ! พบทั้งหมด ${dbMemory.keys.length} คีย์`);
        return;
      } else {
        console.error('❌ [Cloud DB] โหลดข้อมูลจาก Gist ล้มเหลว (Status):', response.statusText);
      }
    } catch (err) {
      console.error('❌ [Cloud DB] เกิดข้อผิดพลาดในการโหลด Gist:', err.message);
    }
  }

  // กรณีดึงจากคลาวด์ไม่ได้ หรือไม่มีการตั้งค่า ให้ดึงจากไฟล์ Local ในเครื่องตามปกติ
  try {
    if (!fs.existsSync(DB_FILE)) {
      dbMemory = { keys: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(dbMemory, null, 2), 'utf8');
      console.log('📦 [Local DB] สร้างไฟล์ฐานข้อมูลใบอนุญาตใหม่เรียบร้อย');
      return;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    dbMemory = JSON.parse(raw);
    console.log(`📦 [Local DB] โหลดคีย์สำเร็จ! พบทั้งหมด ${dbMemory.keys.length} คีย์`);
  } catch (err) {
    console.error('❌ [Local DB] อ่านฐานข้อมูลล้มเหลว:', err.message);
    dbMemory = { keys: [] };
  }
}

function readDb() {
  return dbMemory;
}

function writeDb(data) {
  dbMemory = data;
  
  // 1. เขียนลงไฟล์ Local เพื่อสำรองข้อมูลทันที
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbMemory, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ [Local DB] เขียนข้อมูลลงไฟล์ล้มเหลว:', err.message);
  }

  // 2. ซิงค์ขึ้น GitHub Gist แบบ Asynchronous (หากระบุข้อมูล)
  const GIST_ID = process.env.GITHUB_GIST_ID;
  const GIST_TOKEN = process.env.GITHUB_TOKEN;
  if (GIST_ID && GIST_TOKEN) {
    try {
      fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${GIST_TOKEN}`,
          'User-Agent': 'ShopFlow-License-Server',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: {
            'database.json': {
              content: JSON.stringify(dbMemory, null, 2)
            }
          }
        })
      })
      .then(res => {
        if (res.ok) {
          console.log('🟢 [Cloud DB Sync] ซิงค์คีย์ขึ้น GitHub Gist ล่าสุดสำเร็จ!');
        } else {
          console.error('❌ [Cloud DB Sync] ซิงค์คีย์ขึ้น Gist ล้มเหลว:', res.statusText);
        }
      })
      .catch(err => {
        console.error('❌ [Cloud DB Sync] ผิดพลาดขณะยิงคำขอขึ้น Gist:', err.message);
      });
    } catch (err) {
      console.error('❌ [Cloud DB Sync] ตั้งค่า Gist Sync ผิดพลาด:', err.message);
    }
  }
}

// สร้างคีย์สุ่มสั้นฟอร์แมต SF-XXXX-XXXX
function generateRandomKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let p1 = '';
  let p2 = '';
  for (let i = 0; i < 4; i++) {
    p1 += chars.charAt(Math.floor(Math.random() * chars.length));
    p2 += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SF-${p1}-${p2}`;
}

// ===== API PUBLIC: เช็คสิทธิ์และควบคุมสิทธิ์ใช้งานจากตัวโปรแกรมบอทลูกค้า =====

/**
 * POST /validate — ยืนยันสิทธิ์คีย์ บล็อกเครื่องซ้ำ และลงทะเบียนสิทธิ์
 * Body: { key: "SF-XXXX-XXXX", machineId: "UUID-MACHINE" }
 */
app.post('/validate', (req, res) => {
  const { key, machineId } = req.body;
  if (!key || !machineId) {
    return res.status(400).json({ success: false, error: 'ข้อมูลไม่ครบถ้วน (ต้องการคีย์และรหัสเครื่อง)' });
  }

  const db = readDb();
  const found = db.keys.find(k => k.key === key.trim());

  if (!found) {
    return res.json({ success: false, error: 'ไม่พบรหัสคีย์ใบอนุญาตนี้ในระบบ กรุณาติดต่อผู้พัฒนาบอทเพื่อซื้อสิทธิ์' });
  }

  if (Date.now() > found.expiresAt) {
    return res.json({ success: false, error: 'ใบอนุญาตคีย์นี้หมดอายุการใช้งานแล้ว กรุณาติดต่อแอดมินเพื่อต่ออายุ' });
  }

  // ป้องกันคีย์เครื่องซ้ำ (1 คีย์ ใช้ได้แค่ 1 เครื่องพร้อมกัน)
  if (found.machineId && found.machineId !== machineId) {
    return res.json({ 
      success: false, 
      error: `คีย์นี้ถูกล็อกผูกใช้งานบนเครื่องคอมพิวเตอร์เครื่องอื่นอยู่แล้ว \nกรุณากดปุ่ม "ถอนสิทธิ์เครื่องเก่า (Logout)" ที่เครื่องเดิมก่อน นำมาเปิดใช้งานบนเครื่องนี้` 
    });
  }

  // กรณีเป็นบอร์ดใหม่ที่ยังไม่มีการล็อครหัสเครื่อง ให้จดจำและผูกกับ HWID ทันที
  if (!found.machineId) {
    found.machineId = machineId;
    found.activatedAt = Date.now();
    writeDb(db);
    console.log(`🔒 [Lock Machine] ผูกคีย์ ${key} เข้ากับเครื่องรหัส: ${machineId} สำเร็จ`);
  }

  res.json({
    success: true,
    active: true,
    type: found.type,
    expiresAt: found.expiresAt,
    machineId: found.machineId
  });
});

/**
 * POST /deactivate — ปลดล็อกคีย์ ถอนการลงทะเบียน HWID (Logout) ย้ายเครื่อง
 * Body: { key: "SF-XXXX-XXXX", machineId: "UUID-MACHINE" }
 */
app.post('/deactivate', (req, res) => {
  const { key, machineId } = req.body;
  if (!key || !machineId) {
    return res.status(400).json({ success: false, error: 'ข้อมูลไม่ครบถ้วน' });
  }

  const db = readDb();
  const found = db.keys.find(k => k.key === key.trim());

  if (!found) {
    return res.json({ success: false, error: 'ไม่พบรหัสคีย์นี้ในระบบเช็คสิทธิ์ออนไลน์' });
  }

  if (found.machineId !== machineId) {
    return res.json({ success: false, error: 'ไม่สามารถสั่งถอนสิทธิ์ได้ เนื่องจากคีย์นี้ไม่ได้เปิดใช้ด้วยคอมพิวเตอร์เครื่องนี้' });
  }

  // คืนค่าคีย์ว่าง ให้เครื่องคอมพิวเตอร์อื่นเอาไปลงทะเบียนใช้งานต่อได้
  found.machineId = null;
  found.activatedAt = null;
  writeDb(db);
  console.log(`🔓 [Free Machine] ปลดล็อกคีย์ ${key} ออกจากเครื่องเรียบร้อยแล้ว`);

  res.json({
    success: true,
    message: 'ถอนสิทธิ์คอมพิวเตอร์เครื่องเดิมเรียบร้อยแล้ว! คีย์ใบอนุญาตของคุณว่างแล้ว สามารถนำไปใช้งานบนเครื่องคอมพิวเตอร์เครื่องอื่นได้ทันที'
  });
});

// ===== API ADMIN: ระบบสำหรับแอดมิน (คุณ SITTH) ในการเข้าบริหารจัดการคีย์ =====

// Middleware ตรวจสอบรหัสผ่านความปลอดภัยในการเจนคีย์
function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader === `Bearer ${ADMIN_API_KEY}` || req.body.adminSecret === ADMIN_API_KEY) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'สิทธิ์ไม่ถูกต้อง (รหัสผ่านแอดมินไม่ตรง)' });
}

/**
 * POST /admin/create-key — สร้างคีย์สัญญาสั้นอันใหม่
 * Body: { type: "trial|monthly|lifetime", days: 30, adminSecret: "..." }
 */
app.post('/admin/create-key', adminAuth, (req, res) => {
  const { type, days } = req.body;
  
  if (!type) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุประเภทคีย์ (trial, monthly, lifetime)' });
  }

  let durationDays = days || 30;
  let expiresAt = 0;
  
  if (type === 'trial') {
    durationDays = days || 7;
    expiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
  } else if (type === 'monthly') {
    expiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
  } else if (type === 'lifetime') {
    expiresAt = new Date('2099-12-31T23:59:59Z').getTime();
  } else {
    return res.status(400).json({ success: false, error: 'ประเภทไลเซนส์ไม่ถูกต้อง' });
  }

  const db = readDb();
  const newKey = {
    key: generateRandomKey(),
    type,
    expiresAt,
    machineId: null,
    activatedAt: null,
    createdAt: Date.now()
  };

  db.keys.push(newKey);
  writeDb(db);

  res.json({
    success: true,
    message: 'สร้างคีย์ใบอนุญาตออนไลน์สำเร็จ!',
    data: newKey
  });
});

/**
 * GET /admin/keys — เรียกรายการสิทธิ์คีย์ทั้งหมดในระบบ
 */
app.get('/admin/keys', adminAuth, (req, res) => {
  const db = readDb();
  res.json({ success: true, count: db.keys.length, keys: db.keys });
});

/**
 * POST /admin/reset-key — ปลดบล็อคล็อคเครื่อง (HWID) ให้ลูกค้าทางไกลแบบแมนนวล
 * Body: { key: "SF-XXXX-XXXX" }
 */
app.post('/admin/reset-key', adminAuth, (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสคีย์ที่ต้องการรีเซ็ต' });
  }

  const db = readDb();
  const found = db.keys.find(k => k.key === key.trim());

  if (!found) {
    return res.status(404).json({ success: false, error: 'ไม่พบรหัสคีย์ในระบบ' });
  }

  const oldHwid = found.machineId;
  found.machineId = null;
  found.activatedAt = null;
  writeDb(db);
  console.log(`🧹 [Admin Reset] เคลียร์ HWID ให้คีย์ ${key} (เคยผูกกับ ${oldHwid})`);

  res.json({ 
    success: true, 
    message: `ทำการปลดล็อกรหัสเครื่องคอมของคีย์ ${key} เรียบร้อย ลูกค้านำไปลงทะเบียนย้ายเครื่องใหม่ได้ทันที` 
  });
});

/**
 * DELETE /admin/delete-key — สั่งแบนระงับหรือลบคีย์ออกจากระบบ
 * Body: { key: "SF-XXXX-XXXX" }
 */
app.post('/admin/delete-key', adminAuth, (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุรหัสคีย์ที่ต้องการลบ' });
  }

  const db = readDb();
  const originalCount = db.keys.length;
  db.keys = db.keys.filter(k => k.key !== key.trim());
  
  if (db.keys.length === originalCount) {
    return res.status(404).json({ success: false, error: 'ไม่พบคีย์ที่ต้องการลบ' });
  }
  
  writeDb(db);
  res.json({ success: true, message: `ลบคีย์ ${key} ออกจากระบบเรียบร้อย สิทธิ์การใช้บอทของลูกค้ารายนี้จะหมดไปทันที` });
});

// หน้าตรวจสอบระบบเริ่มต้นง่ายๆ
app.get('/', (req, res) => {
  res.send('<h1>📡 ShopFlow License Server Online</h1><p>ระบบเซิร์ฟเวอร์เช็คสิทธิ์ใบอนุญาตและบริหารจัดการคีย์อัจฉริยะออนไลน์เปิดพร้อมใช้งานแล้ว</p>');
});

// เริ่มต้นโหลดฐานข้อมูล แล้วจึงเปิดทำงานพอร์ตเซิร์ฟเวอร์
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Online License Server กำลังรันทำงานพอร์ต: ${PORT}`);
    console.log(`🔑 รหัสลับสำหรับแอดมิน (Admin API Key): ${ADMIN_API_KEY}`);
    if (process.env.GITHUB_GIST_ID) {
      console.log(`📡 ระบบซิงค์ฐานข้อมูลคลาวด์: GitHub Gist (${process.env.GITHUB_GIST_ID})`);
    } else {
      console.log(`📦 ระบบใช้ฐานข้อมูล Local: database.json`);
    }
    console.log(`=======================================================`);
  });
});
