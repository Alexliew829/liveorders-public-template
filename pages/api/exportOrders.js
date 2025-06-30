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
    const configDoc = await db.collection('config').doc('last_post_id').get();
    const post_id = configDoc.data()?.post_id;
    if (!post_id) {
      return res.status(400).json({ error: '无法获取当前直播贴文 ID' });
    }

    const snapshot = await db
      .collection('triggered_comments')
      .where('post_id', '==', post_id)
      .orderBy('created_at')
      .limit(1000)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: '当前直播没有订单记录' });
    }

    const rows = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        顾客姓名: data.user_name || '匿名',
        商品编号: data.selling_id || '',
        商品名称: data.product_name || '',
        数量: data.quantity ?? 1, // 新字段，默认为 1
        单价: data.price || '0.00'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '订单');

    const buffer = await writeToBuffer(workbook);
    res.setHeader('Content-Disposition', 'attachment; filename="直播订单.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.status(200).send(buffer);

  } catch (err) {
    console.error('[导出失败]', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
