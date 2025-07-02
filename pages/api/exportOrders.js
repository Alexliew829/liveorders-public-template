import { cert, getApps, initializeApp } from 'firebase-admin/app';
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
    if (snapshot.empty) {
      return res.status(400).json({ error: '没有订单可导出' });
    }

    const rawData = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const qty = Number(data.quantity) || 0;
      const price = Number(
        typeof data.price === 'string' ? data.price.replace(/,/g, '') : data.price || 0
      );
      rawData.push({
        user_name: data.user_name || '匿名顾客',
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity: qty,
        price: price,
        total: qty * price,
        replied: data.replied ? '✔' : '✘',
      });
    });

    // ✅ 排序：先按 user_name，再保持留言顺序
    rawData.sort((a, b) => a.user_name.localeCompare(b.user_name));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单');

    // ✅ 设置列
    sheet.columns = [
      { header: '顾客名称', key: 'user_name', width: 20 },
      { header: '商品编号', key: 'selling_id', width: 12 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '价格', key: 'price', width: 12 },
      { header: '总数', key: 'total', width: 15 },
      { header: '已发送连接', key: 'replied', width: 14 },
    ];

    let totalQty = 0;
    let totalAmount = 0;
    let currentUser = '';
    let subQty = 0;
    let subTotal = 0;

    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];

      const isNewUser = row.user_name !== currentUser;
      if (isNewUser && currentUser !== '') {
        // ✅ 插入小计前的分隔线 + 小计行
        sheet.addRow({});
        const subtotalRow = sheet.addRow({
          quantity: subQty,
          total: subTotal.toFixed(2),
        });

        subtotalRow.eachCell((cell) => {
          cell.font = { size: 12 };
        });
        const lastRowIndex = subtotalRow.number;

        sheet.getCell(`D${lastRowIndex - 1}`).border = {
          top: { style: 'thin' }
        };
        sheet.getCell(`D${lastRowIndex}`).border = {
          bottom: { style: 'double' }
        };

        sheet.addRow({});
        subQty = 0;
        subTotal = 0;
      }

      // ✅ 正式写入每一笔订单行
      const dataRow = sheet.addRow({
        user_name: row.user_name,
        selling_id: row.selling_id,
        product_name: row.product_name,
        quantity: row.quantity,
        price: row.price.toFixed(2),
        total: row.total.toFixed(2),
        replied: row.replied,
      });
      dataRow.eachCell((cell) => {
        cell.font = { size: 12 };
      });

      currentUser = row.user_name;
      subQty += row.quantity;
      subTotal += row.total;
      totalQty += row.quantity;
      totalAmount += row.total;
    }

    // ✅ 插入最后一位顾客小计
    if (currentUser !== '') {
      sheet.addRow({});
      const subtotalRow = sheet.addRow({
        quantity: subQty,
        total: subTotal.toFixed(2),
      });
      subtotalRow.eachCell((cell) => {
        cell.font = { size: 12 };
      });
      const lastRowIndex = subtotalRow.number;
      sheet.getCell(`D${lastRowIndex - 1}`).border = {
        top: { style: 'thin' }
      };
      sheet.getCell(`D${lastRowIndex}`).border = {
        bottom: { style: 'double' }
      };
    }

    // ✅ 总计行
    sheet.addRow({});
    const totalRow = sheet.addRow({
      user_name: '✔ 总计：',
      quantity: totalQty,
      total: totalAmount.toFixed(2),
    });
    totalRow.eachCell((cell) => {
      cell.font = { size: 12, bold: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(2);
    const filename = `${day}-${month}-${year} Bonsai-Order.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
