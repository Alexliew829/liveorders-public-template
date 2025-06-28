import { initializeApp, cert, getApps } from 'firebase-admin/app';
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
    const { post_id, comment_id, message, user_id, user_name } = req.body;

    if (!post_id || !comment_id || !message) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    if (user_id === PAGE_ID) {
      return res.status(200).json({ message: '已忽略主页留言' });
    }

    const match = message.match(/[aAbB][\s\-]*0{0,2}(\d{1,3})/);
    if (!match) {
      return res.status(200).json({ message: '无有效商品编号' });
    }

    const prefix = match[0][0].toUpperCase(); // A or B
    const number = match[1].padStart(3, '0'); // 补足为 3 位数
    const selling_id = `${prefix}${number}`;

    const productSnap = await db.collection('live_products').doc(selling_id).get();
    const product = productSnap.exists ? productSnap.data() : {};

    const payload = {
      post_id,
      comment_id,
      message,
      user_id,
      user_name: user_name || '',
      created_at: Date.now(),
      replied: false,
      selling_id,
      product_name: product.product_name || '',
      price: product.price || '',
    };

    const docRef = db.collection('triggered_comments').doc(selling_id);
    const docSnap = await docRef.get();

    if (prefix === 'B') {
      if (docSnap.exists) {
        return res.status(200).json({ message: `B类编号 ${selling_id} 已有人留言，不可重复` });
      } else {
        await docRef.set(payload);
        return res.status(200).json({ message: 'B类留言已写入', docId: selling_id });
      }
    } else {
      await docRef.set(payload); // ✅ A类每次覆盖（使用相同 Document ID）
      return res.status(200).json({ message: 'A类留言已写入（覆盖模式）', docId: selling_id });
    }
  } catch (err) {
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
