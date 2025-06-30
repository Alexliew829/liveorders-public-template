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
    if (snapshot.empty) {
      return res.status(400).json({ error: '导出失败', detail: '没有找到订单资料' });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('订单');

    worksheet.columns = [
      { header: '访客名字', key: 'user_name', width: 30 },
      { header: '商品编号', key: 'selling_id', width: 15 },
      { header: '商品名称', key: 'product_name', width: 30 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '价格', key: 'price', width: 15 },
    ];

    snapshot.forEach(doc => {
      const data = doc.data();
      worksheet.addRow({
        user_name: data.user_name || '',
        selling_id: data.selling_id,
        product_name: data.product_name || '',
        quantity: data.quantity || 1,
        price: data.price || '',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename=orders.xlsx");
    res.status(200).send(buffer);

  } catch (err) {
    console.error('导出失败：', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
