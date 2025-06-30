import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as XLSX from 'xlsx';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  try {
    // 🔁 不再判断 post_id，导出所有 triggered_comments
    const snapshot = await db
      .collection('triggered_comments')
      .orderBy('post_id')
      .limit(1000)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: '目前没有任何订单记录' });
    }

    // 🔢 分析每个访客对每个商品的留言次数
    const countMap = new Map();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const key = `${data.user_id || '匿名'}-${data.selling_id}`;
      const count = countMap.get(key) || { ...data, quantity: 0 };
      count.quantity++;
      countMap.set(key, count);
    }

    const rows = Array.from(countMap.values()).map(entry => ({
      顾客姓名: entry.user_name || '匿名',
      商品编号: entry.selling_id || '',
      商品名称: entry.product_name || '',
      数量: entry.quantity,
      单价: entry.price || '0.00',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '订单');

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="直播订单.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.status(200).send(excelBuffer);

  } catch (err) {
    console.error('[导出失败]', err);
    res.status(500).json({ error: '导出失败', detail: err.message });
  }
}
