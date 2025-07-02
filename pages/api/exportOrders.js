import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import ExcelJS from 'exceljs';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('订单');

  sheet.addRow(['顾客名称', '商品编号', '商品名称', '数量', '价格', '总数', '已发送连接']);

  const snapshot = await db.collection('triggered_comments').get();
  const rows = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (!data.user_name || !data.selling_id || !data.product_name) return;
    const price = parseFloat(data.price || 0);
    const quantity = parseInt(data.quantity || 1);
    rows.push({
      name: data.user_name,
      id: data.selling_id,
      product: data.product_name,
      quantity,
      price,
      total: price * quantity,
      replied: data.replied ? '✓' : '✗',
    });
  });

  rows.sort((a, b) => {
    if (a.name === b.name) return a.id.localeCompare(b.id);
    return a.name.localeCompare(b.name);
  });

  let current = '';
  let subtotalQty = 0;
  let subtotalAmt = 0;
  let totalQty = 0;
  let totalAmt = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.name !== current && current !== '') {
      const lastRow = sheet.lastRow;
      lastRow.getCell(4).border = { top: { style: 'thin' } };
      const subtotalRow = sheet.addRow(['', '', '', subtotalQty, '', subtotalAmt, '']);
      subtotalRow.getCell(4).border = { bottom: { style: 'double' } };
      subtotalRow.getCell(6).border = { bottom: { style: 'double' } };
      subtotalQty = 0;
      subtotalAmt = 0;
      sheet.addRow([]);
    }

    current = r.name;
    subtotalQty += r.quantity;
    subtotalAmt += r.total;
    totalQty += r.quantity;
    totalAmt += r.total;

    sheet.addRow([r.name, r.id, r.product, r.quantity, r.price, r.total, r.replied]);
  }

  // 最后顾客的小计
  const lastRow = sheet.lastRow;
  lastRow.getCell(4).border = { top: { style: 'thin' } };
  const subtotalRow = sheet.addRow(['', '', '', subtotalQty, '', subtotalAmt, '']);
  subtotalRow.getCell(4).border = { bottom: { style: 'double' } };
  subtotalRow.getCell(6).border = { bottom: { style: 'double' } };

  sheet.addRow([]);

  const totalRow = sheet.addRow(['✓ 总计:', '', '', totalQty, '', totalAmt, '']);
  totalRow.font = { bold: true };

  sheet.columns.forEach(col => {
    let maxLen = 10;
    col.eachCell(c => {
      const val = c.value?.toString() || '';
      maxLen = Math.max(maxLen, val.length + 2);
    });
    col.width = maxLen;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="订单.xlsx"');
  res.status(200).end(Buffer.from(buffer)); // ✅ 正确做法
}
