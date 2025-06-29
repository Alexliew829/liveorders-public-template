import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeToBuffer } from 'xlsx';
import * as XLSX from 'xlsx';

// 初始化 Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// 时间格式化函数
function formatTimestamp(ts) {
  if (typeof ts === 'number') {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  }
  if (typeof ts?.toDate === 'function') {
    return ts.toDate().toLocaleString('zh-CN', { hour12: false });
  }
  return '';
}

// API 主函数
export default async function handler(req, res) {
  try {
    // ✅ 获取当前直播的贴文 ID
    const configDoc = await db.collection('config').doc('last_post_id').get();
    const post_id = configDoc.data()?.post_id;
    if (!post_id) {
      return res.status(400).json({ error: '无法获取当前直播贴文 ID' });
    }

    // ✅ 查询 triggered_comments 中所有已发送的订单
    const snapshot = await db
      .collection('triggered_comments')
      .where('post_id', '==', post_id)
      .where('status', '==', 'sent')
      .orderBy('sent_at', 'desc')
      .limit(1000)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: '当前直播没有已付款订单' });
    }

    // ✅ 整理导出数据
    const rows = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        顾客姓名: data.user_name || '匿名',
        顾客FacebookID: data.user_id || '',
        商品编号: data.selling_id || '',
        商品名称: data.product_name || '',
        类别: data.type || '',
        付款金额: data.price_raw ? parseFloat(data.price_raw).toFixed(2) : '0.00',
        留言时间: formatTimestamp(data.created_at),
        发送时间: formatTimestamp(data.sent_at),
        付款连接: data.payment_url || ''
      };
    });

    // ✅ 转换为 Excel 并发送下载
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
