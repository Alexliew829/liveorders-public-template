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

  // 表头
  sheet.addRow([
    '顾客名称',
    '商品编号',
    '商品名称',
    '数量',
    '价格',
    '总数',
    '已发送连接',
  ]);

  // 读取数据
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

  // 排序：顾客 + 商品编号
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

    // 如果是新顾客，插入空行
    if (r.name !== current && current !== '') {
      // 小计行上面加单线，下方加双线
      const lastRow = sheet.lastRow;
      lastRow.getCell(4).border = { top: { style: 'thin' } };
      const subtotalRow = sheet.addRow([
        '',
        '',
        '',
        subtotalQty,
        '',
        subtotalAmt,
        '',
      ]);
      subtotalRow.getCell(4).border = { bottom: { style: 'double' } };
      subtotalRow.getCell(6).border = { bottom: { style: 'double' } };
      subtotalQty = 0;
      subtotalAmt = 0;
      sheet.addRow([]); // 顾客间空行
    }

    current = r.name;
    subtotalQty += r.quantity;
    subtotalAmt += r.total;
    totalQty += r.quantity;
    totalAmt += r.total;

    sheet.addRow([
      r.name,
      r.id,
      r.product,
      r.quantity,
      r.price,
      r.total,
      r.replied,
    ]);
  }

  // 最后一组顾客的小计
  const lastRow = sheet.lastRow;
  lastRow.getCell(4).border = { top: { style: 'thin' } };
  const subtotalRow = sheet.addRow([
    '',
    '',
    '',
    subtotalQty,
    '',
    subtotalAmt,
    '',
  ]);
  subtotalRow.getCell(4).border = { bottom: { style: 'double' } };
  subtotalRow.getCell(6).border = { bottom: { style: 'double' } };

  sheet.addRow([]); // 空行

  // 总计
  const totalRow = sheet.addRow([
    '✓ 总计:',
    '',
    '',
    totalQty,
    '',
    totalAmt,
    '',
  ]);
  totalRow.font = { bold: true };

  // 自动列宽
  sheet.columns.forEach(col => {
    let maxLen = 10;
    col.eachCell(c => {
      const val = c.value?.toString() || '';
      maxLen = Math.max(maxLen, val.length + 2);
    });
    col.width = maxLen;
  });

  // 导出
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="订单.xlsx"'
  );
  res.end(buffer);
}
