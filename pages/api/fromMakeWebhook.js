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

    // 过滤主页账号留言
    if (user_id === PAGE_ID) {
      return res.status(200).json({ message: '已忽略主页留言' });
    }

    // 提取编号（如 A01、B1 等）
    const match = message.match(/[aAbB][\s\-]*0{0,2}(\d{1,3})/);
    if (!match) {
      return res.status(200).json({ message: '无有效商品编号' });
    }

    let prefix = match[0][0].toUpperCase(); // A or B
    let number = match[1].padStart(2, '0'); // 补0
    const selling_id = `${prefix}${number}`;

    // 查询是否已存在（B类只允许写入一次）
    const docRef = db.collection('triggered_comments').doc(selling_id);
    const docSnap = await docRef.get();
    const allowMultiple = prefix === 'A';

    if (docSnap.exists && !allowMultiple) {
      return res.status(200).json({ message: `编号 ${selling_id} 已有留言者（B类限一人）` });
    }

    // 从 live_products 表中抓取商品信息
    const productRef = db.collection('live_products').doc(selling_id);
    const productSnap = await productRef.get();
    const product = productSnap.exists ? productSnap.data() : {};

    const payload = {
      post_id,
      comment_id,
      message,
      user_id: user_id || '',
      user_name: user_name || '',
      created_at: Date.now(),
      replied: false,
      selling_id,
      product_name: product.product_name || '',
      price: product.price || '',
    };

    if (allowMultiple) {
      await db.collection('triggered_comments').add(payload);
    } else {
      await docRef.set(payload); // Document ID = selling_id
    }

    return res.status(200).json({ message: '已写入', payload });
  } catch (err) {
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
