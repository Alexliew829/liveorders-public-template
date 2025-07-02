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
      const price = parseFloat(
        typeof data.price === 'string' ? data.price.replace(/,/g, '') : data.price || 0
      );

      allData.push({
        user_name: data.user_name || '',
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity: qty,
        price,
        total: qty * price,
        replied: data.replied ? '✅' : '❌',
      });
    });

    // ✅ 按顾客名称排序
    allData.sort((a, b) => a.user_name.localeCompare(b.user_name));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单');

    // ✅ 设置列标题
    sheet.columns = [
      { header: '顾客名称', key: 'user_name', width: 20 },
      { header: '商品编号', key: 'selling_id', width: 15 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '价格', key: 'price', width: 15 },
      { header: '总数', key: 'total', width: 15 },
      { header: '已发送连接', key: 'replied', width: 15 },
    ];

    let totalQty = 0;
    let totalAmount = 0;

    let currentUser = '';
    let subTotalQty = 0;
    let subTotalAmount = 0;

    allData.forEach((row, index) => {
      const isNewUser = row.user_name !== currentUser;
      const isLastRow = index === allData.length - 1;

      if (isNewUser && currentUser !== '') {
        // 插入小计行
        sheet.addRow({
          user_name: '',
          selling_id: '',
          product_name: '',
          quantity: subTotalQty,
          price: '',
          total: subTotalAmount.toFixed(2),
          replied: '',
        });
        sheet.addRow({});
        subTotalQty = 0;
        subTotalAmount = 0;
      }

      if (isNewUser) {
        currentUser = row.user_name;
      }

      sheet.addRow({
        user_name: row.user_name,
        selling_id: row.selling_id,
        product_name: row.product_name,
        quantity: row.quantity,
        price: row.price.toFixed(2),
        total: row.total.toFixed(2),
        replied: row.replied,
      });

      totalQty += row.quantity;
      totalAmount += row.total;
      subTotalQty += row.quantity;
      subTotalAmount += row.total;

      if (isLastRow) {
        // ✅ 最后一位顾客的小计
        sheet.addRow({
          user_name: '',
          selling_id: '',
          product_name: '',
          quantity: subTotalQty,
          price: '',
          total: subTotalAmount.toFixed(2),
          replied: '',
        });
      }
    });

    // ✅ 总计行
    sheet.addRow({});
    sheet.addRow({
      user_name: '✅ 总计：',
      quantity: totalQty,
      price: '',
      total: totalAmount.toFixed(2),
      replied: '',
    });

    const buffer = await workbook.xlsx.writeBuffer();

    // ✅ 文件名（日期）
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
