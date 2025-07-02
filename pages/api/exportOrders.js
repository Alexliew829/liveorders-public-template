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

    const data = snapshot.docs.map(doc => doc.data());

    // ✅ 按 user_name 分组
    const grouped = {};
    for (const item of data) {
      const name = item.user_name || '匿名用户';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push(item);
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('订单');

    // ✅ 设置列标题
    sheet.columns = [
      { header: '顾客名称', key: 'user_name', width: 20 },
      { header: '商品编号', key: 'selling_id', width: 15 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '价格', key: 'price', width: 15 },
      { header: '总数', key: 'subtotal', width: 15 },
      { header: '已发送连接', key: 'replied', width: 15 },
    ];

    let totalQty = 0;
    let totalAmount = 0;

    for (const [name, orders] of Object.entries(grouped)) {
      let subQty = 0;
      let subTotal = 0;

      for (const item of orders) {
        const qty = Number(item.quantity) || 0;
        const price = Number(
          typeof item.price === 'string' ? item.price.replace(/,/g, '') : item.price || 0
        );
        const amount = qty * price;

        subQty += qty;
        subTotal += amount;
        totalQty += qty;
        totalAmount += amount;

        sheet.addRow({
          user_name: name,
          selling_id: item.selling_id || '',
          product_name: item.product_name || '',
          quantity: qty,
          price: price.toLocaleString('en-MY', { minimumFractionDigits: 2 }),
          subtotal: amount.toLocaleString('en-MY', { minimumFractionDigits: 2 }),
          replied: item.replied ? '✅' : '❌',
        });
      }

      // ✅ 小计行
      sheet.addRow({
        user_name: '',
        selling_id: '',
        product_name: '',
        quantity: subQty,
        price: '',
        subtotal: subTotal.toLocaleString('en-MY', { minimumFractionDigits: 2 }),
        replied: '',
      });

      // ✅ 插入两行空白
      sheet.addRow({});
      sheet.addRow({});
    }

    // ✅ 最终总计行
    sheet.addRow({
      user_name: '✅ 总计：',
      quantity: totalQty,
      price: '',
      subtotal: totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2 }),
    });

    const buffer = await workbook.xlsx.writeBuffer();

    // ✅ 文件名：02-07-25 Bonsai-Order.xlsx
    const now = new Date();
    const [day, month, year] = [
      String(now.getDate()).padStart(2, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getFullYear()).slice(2),
    ];
    const filename = `${day}-${month}-${year} Bonsai-Order.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
