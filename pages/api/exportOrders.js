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

    const allData = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const qty = Number(data.quantity) || 0;
      const price = Number(
        typeof data.price === 'string' ? data.price.replace(/,/g, '') : data.price || 0
      );

      allData.push({
        user_name: data.user_name || '',
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity: qty,
        price: price,
        total: qty * price,
        replied: data.replied ? '✅' : '❌',
      });
    });

    allData.sort((a, b) => a.user_name.localeCompare(b.user_name));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单');

    // ✅ 设置列
    sheet.columns = [
      { header: '顾客名称', key: 'user_name', width: 20 },
      { header: '商品编号', key: 'selling_id', width: 15 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '价格', key: 'price', width: 15, style: { numFmt: '#,##0.00' } },
      { header: '总数', key: 'total', width: 15, style: { numFmt: '#,##0.00' } },
      { header: '已发送连接', key: 'replied', width: 15 },
    ];

    // ✅ 设置默认字体为 12pt
    sheet.properties.defaultRowHeight = 18;
    sheet.eachRow(row => {
      row.font = { size: 12 };
    });

    let totalQty = 0;
    let totalAmount = 0;
    let currentUser = '';
    let subTotalQty = 0;
    let subTotalAmount = 0;

    for (let i = 0; i < allData.length; i++) {
      const row = allData[i];

      if (row.user_name !== currentUser) {
        if (currentUser !== '') {
          // ✅ 插入小计行并加上单/双线
          const lineAbove = sheet.addRow({});
          const subtotalRow = sheet.addRow({
            user_name: '',
            selling_id: '',
            product_name: '',
            quantity: subTotalQty,
            price: '',
            total: subTotalAmount,
            replied: '',
          });
          const lineBelow = sheet.addRow({});

          // 设置上单线
          for (let col = 1; col <= 7; col++) {
            lineAbove.getCell(col).border = {
              top: { style: 'thin' },
            };
          }
          // 设置下双线
          for (let col = 1; col <= 7; col++) {
            lineBelow.getCell(col).border = {
              bottom: { style: 'double' },
            };
          }
        }

        currentUser = row.user_name;
        subTotalQty = 0;
        subTotalAmount = 0;
      }

      totalQty += row.quantity;
      totalAmount += row.total;
      subTotalQty += row.quantity;
      subTotalAmount += row.total;

      const dataRow = sheet.addRow({
        user_name: row.user_name,
        selling_id: row.selling_id,
        product_name: row.product_name,
        quantity: row.quantity,
        price: row.price,
        total: row.total,
        replied: row.replied,
      });
      dataRow.font = { size: 12 };
    }

    // ✅ 最后一位顾客小计
    if (currentUser !== '') {
      const lineAbove = sheet.addRow({});
      const subtotalRow = sheet.addRow({
        user_name: '',
        selling_id: '',
        product_name: '',
        quantity: subTotalQty,
        price: '',
        total: subTotalAmount,
        replied: '',
      });
      const lineBelow = sheet.addRow({});

      for (let col = 1; col <= 7; col++) {
        lineAbove.getCell(col).border = { top: { style: 'thin' } };
        lineBelow.getCell(col).border = { bottom: { style: 'double' } };
      }
    }

    // ✅ 总计行
    sheet.addRow({});
    sheet.addRow({
      user_name: '✅ 总计：',
      quantity: totalQty,
      price: '',
      total: totalAmount,
      replied: '',
    });

    const buffer = await workbook.xlsx.writeBuffer();

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(2);
    const today = `${day}-${month}-${year}`;
    const filename = `${today} Bonsai-Order.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
