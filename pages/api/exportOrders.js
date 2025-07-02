import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import ExcelJS from 'exceljs';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db.collection('triggered_comments').orderBy('created_at', 'asc').get();
    const ordersMap = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();
      const user_id = data.user_id || 'anonymous';
      const user_name = data.user_name || '匿名顾客';

      if (!ordersMap.has(user_id)) {
        ordersMap.set(user_id, {
          user_id,
          user_name,
          items: [],
          hasReplied: false,
        });
      }

      const order = ordersMap.get(user_id);

      const rawPrice = typeof data.price === 'string' ? data.price.replace(/,/g, '') : data.price;
      const unitPrice = parseFloat(rawPrice) || 0;
      const quantity = parseInt(data.quantity || 1);
      const subtotal = unitPrice * quantity;

      order.items.push({
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity,
        price: unitPrice,
        subtotal,
        replied: data.replied || false,
      });

      if (data.replied) order.hasReplied = true;
    });

    // 创建 Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单');
    sheet.properties.defaultRowHeight = 20;

    // 设置标题行
    const header = ['顾客名称', '商品编号', '商品名称', '数量', '价格', '总数', '已发送连接'];
    sheet.addRow(header);
    sheet.getRow(1).font = { name: 'Calibri', size: 12, bold: true };

    let grandTotalQty = 0;
    let grandTotalAmount = 0;

    for (const [, order] of ordersMap) {
      const { user_name, items, hasReplied } = order;
      let totalQty = 0;
      let totalAmount = 0;
      const startRow = sheet.lastRow.number + 1;

      for (const item of items) {
        const row = sheet.addRow([
          user_name,
          item.selling_id,
          item.product_name,
          item.quantity,
          item.price,
          item.subtotal,
          item.replied ? '✔' : '✘',
        ]);
        row.font = { name: 'Calibri', size: 12 };

        totalQty += item.quantity;
        totalAmount += item.subtotal;
      }

      // 添加小计行（无空行）
      const subtotalRow = sheet.addRow(['', '', '', totalQty, '', totalAmount, '']);
      subtotalRow.font = { name: 'Calibri', size: 12 };

      // 添加单线 + 双线框线（D~F栏）
      const D = 4, F = 6;
      for (let col = D; col <= F; col++) {
        sheet.getCell(startRow, col).border = {
          top: { style: 'thin' },
        };
        sheet.getCell(subtotalRow.number, col).border = {
          bottom: { style: 'double' },
        };
      }

      grandTotalQty += totalQty;
      grandTotalAmount += totalAmount;
    }

    // 总计行
    sheet.addRow(['✔ 总计:', '', '', grandTotalQty, '', grandTotalAmount, '']);
    const lastRow = sheet.lastRow;
    lastRow.font = { name: 'Calibri', size: 12, bold: true };

    // 设置列宽
    const widths = [20, 12, 30, 8, 10, 12, 12];
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });

    // 设置货币格式（E 与 F）
    sheet.getColumn(5).numFmt = '#,##0.00';
    sheet.getColumn(6).numFmt = '#,##0.00';

    // 导出为文件
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=bonsai-orders.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Export Error:', err);
    res.status(500).json({ error: '生成 Excel 失败', detail: err.message });
  }
}
