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
    const { post_id, comment_id, message, user_id, user_name, force } = req.body;
    const isForce = force === true || force === 'true';

    if (!post_id || !comment_id || !message) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    if (user_id === PAGE_ID) {
      return res.status(200).json({ message: '已忽略主页留言' });
    }

    // ✅ 更宽容匹配 A/B 编号：支持 A-32, a 32, A_032 等
    const match = message.match(/[aAbB][\s\-_.～]*0{0,2}(\d{1,3})/);
    if (!match) {
      return res.status(200).json({ message: '无有效商品编号' });
    }

    const prefix = match[0][0].toUpperCase(); // A or B
    const number = match[1].padStart(3, '0'); // 补零到三位
    const selling_id = `${prefix}${number}`;

    // ✅ 提取数量（如 A32-5）
    let quantity = 1; // 默认数量为 1
    const qtyMatch = message.match(/-\s*(\d{1,2})\b/);
    if (qtyMatch) {
      const parsedQty = parseInt(qtyMatch[1]);
      if (!isNaN(parsedQty) && parsedQty >= 1) quantity = parsedQty;
    }

    // ✅ 确保商品存在于 live_products
    const productRef = db.collection('live_products').doc(selling_id);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      return res.status(200).json({ message: `编号 ${selling_id} 不存在于商品列表中，已忽略` });
    }

    const product = productSnap.data();

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
      quantity
    };

    if (prefix === 'B') {
      // ✅ B类商品，只记录第一位顾客，除非 force 模式
      const docRef = db.collection('triggered_comments').doc(selling_id);
      if (!isForce) {
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          return res.status(200).json({ message: `编号 ${selling_id} 已有留言者（B类限一人）` });
        }
      }
      await docRef.set(payload);
      return res.status(200).json({ message: 'B类留言已写入', doc_id: selling_id });

    } else {
      // ✅ A类商品，可多人留言，不重复写入除非 force
      const docId = `${selling_id}_${comment_id}`;
      if (!isForce) {
        const existing = await db.collection('triggered_comments').doc(docId).get();
        if (existing.exists) {
          return res.status(200).json({ message: 'A类订单已存在，跳过' });
        }
      }
      await db.collection('triggered_comments').doc(docId).set(payload);
      return res.status(200).json({ message: 'A类留言已写入（多人）', doc_id: docId });
    }

  } catch (err) {
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
