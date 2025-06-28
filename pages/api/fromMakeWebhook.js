import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const { from, message, post_id, comment_id } = req.body;

    if (!message || !from || !post_id || !comment_id) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    // 排除主页留言
    if (from.id === PAGE_ID) {
      return res.status(200).json({ skip: '主页留言略过' });
    }

    const user_id = from.id;
    const user_name = from.name || '';
    const text = message;

    // 提取编号（支持 A/B + 数字，支持空格或 0 开头）
    const match = text.match(/\\b([ABab])\\s*0*([1-9][0-9]?)\\b/);
    if (!match) {
      return res.status(200).json({ skip: '无有效商品编号' });
    }

    const type = match[1].toUpperCase(); // A or B
    const number = match[2].padStart(3, '0'); // 如 001、099
    const selling_id = `${type}${number}`;

    // 查询商品资料
    const productSnap = await db.collection('live_products').doc(selling_id).get();
    if (!productSnap.exists) {
      return res.status(200).json({ skip: '商品不存在' });
    }

    const { product_name, price } = productSnap.data();

    const payload = {
      selling_id,
      product_name,
      price,
      message: text,
      user_id,
      user_name,
      post_id,
      comment_id,
      created_at: Date.now(),
      replied: false,
    };

    if (type === 'A') {
      // 多人下单，使用唯一 ID
      const uniqueId = `${selling_id}_${Date.now()}`;
      await db.collection('triggered_comments').doc(uniqueId).set(payload);
      return res.status(200).json({ status: '写入 A 类成功', doc_id: uniqueId });
    } else {
      // 只允许第一人下单
      const bDoc = db.collection('triggered_comments').doc(selling_id);
      const bExists = await bDoc.get();
      if (bExists.exists) {
        return res.status(200).json({ skip: 'B 类已有留言' });
      }
      await bDoc.set(payload);
      return res.status(200).json({ status: '写入 B 类成功', doc_id: selling_id });
    }

  } catch (err) {
    console.error('处理失败:', err);
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
