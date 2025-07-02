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

  // 设置标题栏样式
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
  let totalAmount = 0;

  const borderStyle = {
    style: 'thin',
    color: { argb: 'FF000000' },
  };

  for (const [customer, orders] of Object.entries(grouped)) {
    let subQty = 0;
    let subTotal = 0;
    const startRow = sheet.lastRow.number + 1;

    for (const order of orders) {
      const { selling_id, product_name, price, replied, quantity = 1 } = order;
      const total = Number(price) * Number(quantity);
      subQty += Number(quantity);
      subTotal += total;

      sheet.addRow([
        customer,
        selling_id,
        product_name,
        quantity,
        Number(price),
        total,
        replied ? '✔' : '✘',
      ]).font = { name: 'Calibri', size: 12 };
    }

    // 小计行
    const subtotalRow = sheet.addRow(['', '', '', subQty, '', subTotal, '']);
    subtotalRow.font = { name: 'Calibri', size: 12 };
    subtotalRow.eachCell((cell, colNumber) => {
      if ([4, 6].includes(colNumber)) {
        cell.border = { top: borderStyle };
      }
    });

    // 汇总统计
    totalQty += subQty;
    totalAmount += subTotal;

    // 空行分隔不同顾客
    sheet.addRow([]);
  }

  // 最终总计行
  sheet.addRow(['✔ 总计:', '', '', totalQty, '', totalAmount, '']);
  const lastRow = sheet.lastRow;
  lastRow.font = { name: 'Calibri', size: 12, bold: true };
  lastRow.eachCell((cell, colNumber) => {
    if ([4, 6].includes(colNumber)) {
      cell.border = {
        top: borderStyle,
        bottom: borderStyle,
      };
    }
  });

  // 自动列宽
  sheet.columns.forEach(col => {
    let maxLength = 10;
    col.eachCell(cell => {
      const val = String(cell.value || '');
      maxLength = Math.max(maxLength, val.length + 2);
    });
    col.width = maxLength;
  });

  // 导出 Excel
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.xlsx');
  await workbook.xlsx.write(res);
  res.end();
}
