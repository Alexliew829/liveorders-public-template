import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeToBuffer } from 'xlsx';
import * as XLSX from 'xlsx';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db
      .collection('triggered_comments')
      .where('status', '==', 'sent')
      .orderBy('sent_at', 'desc')
      .limit(1000)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: '没有找到任何已发送订单' });
    }

    const rows = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        顾客姓名: data.user_name || '匿名',
        顾客FacebookID: data.user_id || '',
        商品编号: data.selling_id || '',
        商品名称: data.product_name || '',
        类别: data.category || '',
        付款金额: data.price_raw ? parseFloat(data.price_raw).toFixed(2) : '0.00',
        留言时间: data.created_at?.toDate?.().toISOString() || '',
        发送时间: data.sent_at?.toDate?.().toISOString() || '',
        付款连接: data.payment_url || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '订单');

    const buffer = await writeToBuffer(workbook);

    res.setHeader('Content-Disposition', 'attachment; filename="orders.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.status(200).send(buffer);
  } catch (err) {
    console.error('[导出失败]', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
