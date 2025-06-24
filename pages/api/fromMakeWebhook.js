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

  const { from, message, post_id, comment_id } = req.body;

  if (!from || from.id === PAGE_ID) {
    return res.status(200).json({ status: '忽略主页留言' });
  }

  // 宽容匹配格式：B01、b 01、b-01、A_65、a~032
  const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
  if (!match) {
    return res.status(200).json({ status: '无效商品留言格式' });
  }

  const type = match[1].toUpperCase();
  const number = match[2].padStart(3, '0');
  const selling_id = `${type}${number}`;

  try {
    const productRef = db.collection('live_products').doc(selling_id);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      return res.status(200).json({ status: '商品编号不存在', selling_id });
    }

    const productData = productSnap.data();
    const isClassA = type === 'A';
    const commentRef = db.collection('triggered_comments').doc(comment_id);

    if (isClassA) {
      await commentRef.set({
        user_id: from.id,
        user_name: from.name || null,
        selling_id,
        post_id,
        comment_id,
        created_at: new Date().toISOString(),
        replied: false,
      });
      return res.status(200).json({ status: '成功写入 A 类订单', selling_id });
    }

    const existingB = await db.collection('triggered_comments')
      .where('selling_id', '==', selling_id)
      .limit(1)
      .get();

    if (!existingB.empty) {
      return res.status(200).json({ status: 'B 类商品已有人下单', selling_id });
    }

    await commentRef.set({
      user_id: from.id,
      user_name: from.name || null,
      selling_id,
      post_id,
      comment_id,
      created_at: new Date().toISOString(),
      replied: false,
    });

    return res.status(200).json({ status: '成功写入 B 类订单', selling_id });

  } catch (err) {
    console.error('写入失败:', err);
    return res.status(500).json({ error: '写入数据库失败', message: err.message });
  }
}
