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
  const sheet = workbook.addWorksheet('订单', {
    properties: { defaultRowHeight: 20 },
    pageSetup: { fitToPage: true, fitToWidth: 1 }
  });

  // 设置标题栏样式
  sheet.columns = [
    { header: '顾客名称', key: 'user_name', width: 22 },
    { header: '商品编号', key: 'selling_id', width: 10 },
    { header: '商品名称', key: 'product_name', width: 30 },
    { header: '数量', key: 'quantity', width: 10 },
    { header: '价格', key: 'price', width: 12 },
    { header: '总数', key: 'total', width: 14 },
    { header: '已发送连接', key: 'replied', width: 14 }
  ];
  sheet.getRow(1).font = { bold: true, size: 12 };

  // 读取数据库
  const snapshot = await db.collection('triggered_comments').get();
  const orders = snapshot.docs.map(doc => doc.data());

  const grouped = {};
  for (const order of orders) {
    const name = order.user_name || '匿名顾客';
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(order);
  }

  let rowCursor = 2;
  let grandTotalQty = 0;
  let grandTotalAmount = 0;

  const currencyFormat = '#,##0.00';

  const sortedNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  for (const name of sortedNames) {
    const rows = grouped[name];
    let customerQty = 0;
    let customerAmount = 0;

    for (const order of rows) {
      const { selling_id, product_name, quantity, price, replied } = order;
      const total = quantity * price;
      sheet.getRow(rowCursor).font = { size: 12 };
      sheet.addRow({
        user_name: name,
        selling_id,
        product_name,
        quantity,
        price,
        total,
        replied: replied ? '✔️' : '❌'
      });

      sheet.getCell(`E${rowCursor}`).numFmt = currencyFormat;
      sheet.getCell(`F${rowCursor}`).numFmt = currencyFormat;

      customerQty += quantity;
      customerAmount += total;
      rowCursor++;
    }

    // 单线
    sheet.getRow(rowCursor).font = { size: 12 };
    sheet.addRow({ quantity: customerQty, total: customerAmount });
    sheet.getCell(`E${rowCursor}`).numFmt = currencyFormat;
    sheet.getCell(`F${rowCursor}`).numFmt = currencyFormat;
    sheet.getCell(`D${rowCursor}`).border = { top: { style: 'thin' } };
    sheet.getCell(`E${rowCursor}`).border = { top: { style: 'thin' } };
    sheet.getCell(`F${rowCursor}`).border = { top: { style: 'thin' } };
    rowCursor++;

    // 双线
    sheet.getRow(rowCursor).font = { size: 12 };
    sheet.addRow({});
    sheet.getCell(`D${rowCursor}`).border = { bottom: { style: 'double' } };
    sheet.getCell(`E${rowCursor}`).numFmt = currencyFormat;
    sheet.getCell(`E${rowCursor}`).border = { bottom: { style: 'double' } };
    sheet.getCell(`F${rowCursor}`).numFmt = currencyFormat;
    sheet.getCell(`F${rowCursor}`).border = { bottom: { style: 'double' } };
    rowCursor++;

    grandTotalQty += customerQty;
    grandTotalAmount += customerAmount;
  }

  // 最终总计行
  sheet.getRow(rowCursor).font = { size: 12 };
  sheet.addRow({ user_name: '✔️ 总计：', quantity: grandTotalQty, total: grandTotalAmount });
  sheet.getCell(`E${rowCursor}`).numFmt = currencyFormat;
  sheet.getCell(`F${rowCursor}`).numFmt = currencyFormat;

  // 导出 Excel
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename=orders.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}
