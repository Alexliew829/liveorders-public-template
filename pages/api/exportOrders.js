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
  let totalAmount = 0;

  const borderThin = { style: 'thin', color: { argb: 'FF000000' } };
  const borderDouble = { style: 'double', color: { argb: 'FF000000' } };

  for (const [customer, orders] of Object.entries(grouped)) {
    let subQty = 0;
    let subTotal = 0;

    for (const order of orders) {
      const { selling_id, product_name, price, quantity = 1 } = order;
      const priceNum = Number(price);
      const total = priceNum * Number(quantity);
      subQty += Number(quantity);
      subTotal += total;

      const row = sheet.addRow([
        customer,
        selling_id,
        product_name,
        quantity,
        priceNum,
        total,
        ''  // ✅ 不在每个商品行显示“已发送连接”
      ]);
      row.font = { name: 'Calibri', size: 12 };
      row.getCell(5).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
    }

    const replied = orders[0].replied_public; // ✅ 改为判断公开留言是否已发送
    const subtotalRow = sheet.addRow([
      '', '', '', subQty, '', subTotal,
      replied ? '✔' : '✘'  // ✅ 小计行才显示是否已发送
    ]);
    subtotalRow.font = { name: 'Calibri', size: 12 };
    subtotalRow.getCell(6).numFmt = '#,##0.00';

    [4, 5, 6].forEach(col => {
      const cell = subtotalRow.getCell(col);
      cell.border = {
        top: borderThin,
        bottom: borderDouble,
      };
    });

    totalQty += subQty;
    totalAmount += subTotal;

    sheet.addRow([]);
  }

  const totalRow = sheet.addRow(['✔ 总计:', '', '', totalQty, '', totalAmount, '']);
  totalRow.font = { name: 'Calibri', size: 12, bold: true };
  totalRow.getCell(6).numFmt = '#,##0.00';
  [4, 6].forEach(col => {
    totalRow.getCell(col).border = {
      top: borderThin,
      bottom: borderThin,
    };
  });

  // ✅ 自动列宽 + 指定固定宽度
  sheet.columns.forEach((col, index) => {
    let maxLength = 10;
    col.eachCell(cell => {
      const val = String(cell.value || '');
      maxLength = Math.max(maxLength, val.length + 2);
    });

    if (index === 2) { // C栏 商品名称
      maxLength = 21;
    }

    if (index === 6 && maxLength < 8) {
      maxLength = 10; // F栏 总数
    }

    if (index === 7) {
      maxLength = 15; // G栏“已发送连接”
    }

    col.width = maxLength;
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.xlsx');
  await workbook.xlsx.write(res);
  res.end();
}
