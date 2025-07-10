import ExcelJS from 'exceljs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('订单');

  const header = ['顾客名称', '商品编号', '商品名称', '数量', '价格', '总数', '已发送连接'];
  sheet.addRow(header);
  sheet.getRow(1).font = { name: 'Calibri', size: 12, bold: true };

  const triggeredSnapshot = await db.collection('triggered_comments').orderBy('user_name').get();

  const grouped = {};
  for (const doc of triggeredSnapshot.docs) {
    const data = doc.data();
    const name = data.user_name || '匿名用户';
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push({ ...data, id: doc.id });
  }

  let totalQty = 0;
  let startRowIdx = 2; // 从第2行开始（因为第1行为标题）

  const borderThin = { style: 'thin', color: { argb: 'FF000000' } };
  const borderDouble = { style: 'double', color: { argb: 'FF000000' } };

  for (const [customer, orders] of Object.entries(grouped)) {
    const start = sheet.rowCount + 1;
    let subQty = 0;

    for (const order of orders) {
      const { selling_id, product_name, price, quantity = 1 } = order;
      subQty += Number(quantity);

      const row = sheet.addRow([
        customer,
        selling_id,
        product_name,
        quantity,
        Number(price),
        null, // 等下插入公式
        ''
      ]);
      const rowNumber = row.number;

      // 设置公式（总数 = 数量 * 价格）
      row.getCell(6).value = {
        formula: `D${rowNumber}*E${rowNumber}`
      };
      row.getCell(5).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
      row.font = { name: 'Calibri', size: 12 };
    }

    const end = sheet.rowCount;
    const replied = orders[0].replied_public;

    const subtotalRow = sheet.addRow([
      '', '', '', subQty, '',
      { formula: `SUM(F${start}:F${end})` },
      replied ? '✔' : '✘'
    ]);
    subtotalRow.font = { name: 'Calibri', size: 12 };
    subtotalRow.getCell(6).numFmt = '#,##0.00';

    [4, 5, 6].forEach(col => {
      subtotalRow.getCell(col).border = {
        top: borderThin,
        bottom: borderDouble,
      };
    });

    totalQty += subQty;
    sheet.addRow([]);
  }

  const totalRowNumber = sheet.rowCount + 1;

  const totalRow = sheet.addRow([
    '✔ 总计:', '', '', totalQty, '',
    { formula: `SUM(F2:F${totalRowNumber - 1})` },
    ''
  ]);
  totalRow.font = { name: 'Calibri', size: 12, bold: true };
  totalRow.getCell(6).numFmt = '#,##0.00';

  [4, 6].forEach(col => {
    totalRow.getCell(col).border = {
      top: borderThin,
      bottom: borderThin,
    };
  });

  // ✅ 自动列宽
  sheet.columns.forEach((col, index) => {
    let maxLength = 10;
    col.eachCell(cell => {
      const val = String(cell.value || '');
      maxLength = Math.max(maxLength, val.length + 2);
    });

    if (index === 2) maxLength = 21;
    if (index === 6 && maxLength < 8) maxLength = 10;
    if (index === 7) maxLength = 15;

    col.width = maxLength;
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.xlsx');
  await workbook.xlsx.write(res);
  res.end();
}
