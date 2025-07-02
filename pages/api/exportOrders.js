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

  // 设置标题栏
  sheet.addRow([
    '顾客名称', '商品编号', '商品名称', '数量', '价格', '总数', '已发送连接'
  ]);
  sheet.getRow(1).font = { bold: true };

  // 获取订单数据
  const snapshot = await db.collection('triggered_comments').orderBy('user_name').get();
  const rows = [];
  const customerGroups = new Map();

  snapshot.forEach(doc => {
    const data = doc.data();
    const key = data.user_name;

    if (!customerGroups.has(key)) {
      customerGroups.set(key, []);
    }

    customerGroups.get(key).push({
      name: data.user_name,
      id: data.selling_id,
      product_name: data.product_name,
      quantity: data.quantity || 1,
      price: data.price || 0,
      sent: data.replied || false
    });
  });

  let totalQuantity = 0;
  let totalAmount = 0;

  for (const [name, orders] of customerGroups.entries()) {
    let customerTotalQty = 0;
    let customerTotalAmt = 0;
    const startRow = sheet.rowCount + 1;

    for (const order of orders) {
      const total = order.quantity * order.price;
      sheet.addRow([
        name,
        order.id,
        order.product_name,
        order.quantity,
        order.price,
        total,
        order.sent ? '✔️' : '❌'
      ]);

      customerTotalQty += order.quantity;
      customerTotalAmt += total;
      totalQuantity += order.quantity;
      totalAmount += total;
    }

    const endRow = sheet.rowCount;
    const borderStyle = { style: 'thin' };

    // ✅ 单线加在顾客订单最后一行上方
    if (orders.length > 1) {
      sheet.getCell(`D${endRow}`).border = {
        top: borderStyle
      };
      sheet.getCell(`E${endRow}`).border = {
        top: borderStyle
      };
      sheet.getCell(`F${endRow}`).border = {
        top: borderStyle
      };
    }

    // ✅ 双线加在顾客订单最后一行
    sheet.getCell(`D${endRow + 1}`).value = customerTotalQty;
    sheet.getCell(`E${endRow + 1}`).value = '';
    sheet.getCell(`F${endRow + 1}`).value = customerTotalAmt;

    sheet.getCell(`D${endRow + 1}`).border = { top: borderStyle, bottom: { style: 'double' } };
    sheet.getCell(`E${endRow + 1}`).border = { top: borderStyle, bottom: { style: 'double' } };
    sheet.getCell(`F${endRow + 1}`).border = { top: borderStyle, bottom: { style: 'double' } };
  }

  // ✅ 最底部总计
  const finalRow = sheet.addRow([]);
  sheet.addRow([
    '✔️ 总计：', '', '', totalQuantity, '', totalAmount
  ]);
  const lastRow = sheet.lastRow;
  lastRow.font = { bold: true };

  // 设置列宽
  const widths = [20, 10, 30, 8, 10, 12, 12];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  // 金额列格式
  sheet.getColumn('E').numFmt = 'RM#,##0.00';
  sheet.getColumn('F').numFmt = 'RM#,##0.00';

  // ✅ 设置响应头并导出文件
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="订单.xlsx"');

  const buffer = await workbook.xlsx.writeBuffer();
  res.end(buffer); // ✅ 用 end 替代 send，避免文件损坏
}
