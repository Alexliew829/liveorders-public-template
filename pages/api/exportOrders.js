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
    const snapshot = await db.collection('triggered_comments').get();
    const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (orders.length === 0) {
      return res.status(404).send('没有订单资料');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('订单', {
      properties: { defaultRowHeight: 20 },
      pageSetup: { orientation: 'landscape' }
    });

    worksheet.columns = [
      { header: '顾客名称', key: 'user_name', width: 22 },
      { header: '商品编号', key: 'selling_id', width: 12 },
      { header: '商品名称', key: 'product_name', width: 32 },
      { header: '数量', key: 'qty', width: 10 },
      { header: '价格', key: 'price', width: 12 },
      { header: '总数', key: 'subtotal', width: 14 },
      { header: '已发送连接', key: 'replied', width: 14 }
    ];

    // 样式设定
    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.eachRow(row => {
      row.alignment = { vertical: 'middle', horizontal: 'left' };
      row.font = { name: 'Calibri', size: 12 };
    });

    // 分组与汇总
    const grouped = {};
    for (const order of orders) {
      const { user_name, selling_id, product_name, price, qty, replied } = order;
      const key = user_name || '匿名顾客';
      if (!grouped[key]) grouped[key] = [];

      grouped[key].push({
        selling_id,
        product_name,
        price: Number(price),
        qty: Number(qty),
        subtotal: Number(price) * Number(qty),
        replied: replied ? '✔' : '✘'
      });
    }

    let grandQty = 0;
    let grandTotal = 0;
    let rowIndex = 2;

    for (const user in grouped) {
      const userOrders = grouped[user];
      let subtotalQty = 0;
      let subtotalAmount = 0;

      for (const item of userOrders) {
        worksheet.addRow({
          user_name: user,
          selling_id: item.selling_id,
          product_name: item.product_name,
          qty: item.qty,
          price: item.price,
          subtotal: item.subtotal,
          replied: item.replied
        });
        rowIndex++;
        subtotalQty += item.qty;
        subtotalAmount += item.subtotal;
        grandQty += item.qty;
        grandTotal += item.subtotal;
      }

      // 小计行（空白 + 小计数 + border）
      worksheet.addRow({
        qty: subtotalQty,
        subtotal: subtotalAmount
      });
      worksheet.mergeCells(`A${rowIndex}:C${rowIndex}`);
      const qtyCell = worksheet.getCell(`D${rowIndex}`);
      const totalCell = worksheet.getCell(`F${rowIndex}`);
      qtyCell.border = totalCell.border = {
        top: { style: 'thin' }
      };
      rowIndex++;
    }

    // 总计行
    worksheet.addRow({
      user_name: '✔ 总计：',
      qty: grandQty,
      subtotal: grandTotal
    });
    const totalRow = worksheet.lastRow;
    totalRow.font = { bold: true, size: 12 };
    worksheet.mergeCells(`A${totalRow.number}:C${totalRow.number}`);

    const qtyCell = worksheet.getCell(`D${totalRow.number}`);
    const totalCell = worksheet.getCell(`F${totalRow.number}`);
    qtyCell.border = totalCell.border = {
      bottom: { style: 'double' }
    };

    // 对齐数值类
    for (let i = 2; i <= worksheet.rowCount; i++) {
      worksheet.getCell(`D${i}`).alignment = { horizontal: 'right' };
      worksheet.getCell(`E${i}`).alignment = { horizontal: 'right' };
      worksheet.getCell(`F${i}`).alignment = { horizontal: 'right' };
    }

    // 设置 response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="订单.xlsx"');

    const buffer = await workbook.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('导出失败');
  }
}
