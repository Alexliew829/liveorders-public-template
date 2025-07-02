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

    // ✅ 按 user_name 分组
    const orders = {};
    snapshot.forEach((doc) => {
      const data = doc.data();
      const name = data.user_name || '匿名用户';
      if (!orders[name]) orders[name] = [];
      orders[name].push(data);
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单');

    // ✅ 设置表头
    sheet.columns = [
      { header: '顾客名称', key: 'user_name', width: 20 },
      { header: '商品编号', key: 'selling_id', width: 15 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '价格', key: 'price', width: 15 },
      { header: '总数', key: 'subtotal', width: 15 },
      { header: '已发送连接', key: 'replied', width: 15 },
    ];

    let grandQty = 0;
    let grandTotal = 0;

    for (const [user, items] of Object.entries(orders)) {
      let userQty = 0;
      let userTotal = 0;

      for (const item of items) {
        const qty = parseInt(item.quantity || 0);
        const price = parseFloat((item.price || '0').toString().replace(/,/g, ''));
        const subtotal = qty * price;

        userQty += qty;
        userTotal += subtotal;
        grandQty += qty;
        grandTotal += subtotal;

        sheet.addRow({
          user_name: item.user_name || '',
          selling_id: item.selling_id || '',
          product_name: item.product_name || '',
          quantity: qty,
          price: price.toFixed(2),
          subtotal: subtotal.toFixed(2),
          replied: item.replied ? '✅' : '❌',
        });
      }

      // ✅ 顾客小计行
      sheet.addRow({
        user_name: '',
        selling_id: '',
        product_name: '',
        quantity: userQty,
        subtotal: userTotal.toFixed(2),
      });

      // ✅ 插入空行作为分隔
      sheet.addRow({});
    }

    // ✅ 总计行
    sheet.addRow({
      user_name: '✅ 总计：',
      quantity: grandQty,
      subtotal: grandTotal.toFixed(2),
    });

    // ✅ 生成 Buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // ✅ 生成文件名
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
