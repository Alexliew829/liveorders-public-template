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

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('订单');

    worksheet.columns = [
      { header: '商品编号', key: 'selling_id', width: 15 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '价格', key: 'price', width: 12 },
      { header: '顾客ID', key: 'user_id', width: 24 },
      { header: '顾客名称', key: 'user_name', width: 20 },
      { header: '留言ID', key: 'comment_id', width: 24 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '已发送连接', key: 'replied', width: 12 }
    ];

    snapshot.forEach(doc => {
      const data = doc.data();
      worksheet.addRow({
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        price: data.price || '',
        user_id: data.user_id || '',
        user_name: data.user_name || '',
        comment_id: data.comment_id || '',
        quantity: data.quantity || 1,
        replied: data.replied ? '✅' : '❌'
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bonsai-orders.xlsx"');
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
