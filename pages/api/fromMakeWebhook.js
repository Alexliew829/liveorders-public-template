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

    if (from?.id === PAGE_ID) {
      return res.status(200).json({ skip: '管理员留言略过' });
    }

    const user_id = from?.id || '';
    const user_name = from?.name || '';
    const text = message || '';

    // 匹配编号（A101、b 001、B999）
    const match = text.match(/\b([ABab])\s*0*([1-9][0-9]?)\b/);
    if (!match) {
      return res.status(200).json({ skip: '未发现商品编号' });
    }

    const type = match[1].toUpperCase();  // A 或 B
    const number = match[2].padStart(3, '0'); // 001~099
    const selling_id = `${type}${number}`;  // A001 或 B099

    // 查找商品资料
    const productSnap = await db.collection('live_products').doc(selling_id).get();
    if (!productSnap.exists) {
      return res.status(200).json({ skip: '未找到商品资料' });
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
      // A 类：允许重复，Document ID 为 A编号_留言ID
      const docId = `${selling_id}_${comment_id}`;
      await db.collection('triggered_comments').doc(docId).set(payload);
      return res.status(200).json({ status: '写入 A 类订单', docId });
    } else {
      // B 类：只记录第一位
      const docRef = db.collection('triggered_comments').doc(selling_id);
      const exists = await docRef.get();
      if (exists.exists) {
        return res.status(200).json({ skip: 'B 类订单已存在' });
      }
      await docRef.set(payload);
      return res.status(200).json({ status: '写入 B 类订单', docId: selling_id });
    }

  } catch (err) {
    console.error('写入失败:', err);
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
