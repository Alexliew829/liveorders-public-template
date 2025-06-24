// pages/api/confirmAllOrders.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  const isDebug = req.query.debug !== undefined;
  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    // 获取商品清单（判断 A/B 类型）
    const productsSnap = await db.collection('live_products').get();
    const productsMap = {};
    for (const doc of productsSnap.docs) {
      productsMap[doc.id] = doc.data();
    }

    let success = 0;
    let skipped = 0;

    for (const comment of comments) {
      const { message, from, id: comment_id } = comment;
      if (!message || !from || from.id === PAGE_ID) continue;

      // 提取编号（宽容前后最多两个字/符号）
      const match = message.match(/.{0,2}([AB])[ \-_.~]*0*(\d{1,3}).{0,2}/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      const product = productsMap[selling_id];
      if (!product) {
        skipped++;
        continue;
      }

      // 检查是否已存在订单
      if (type === 'B') {
        const existing = await db.collection('triggered_comments').doc(selling_id).get();
        if (existing.exists) {
          skipped++;
          continue;
        }
      } else if (type === 'A') {
        const dup = await db.collection('triggered_comments')
          .where('selling_id', '==', selling_id)
          .where('user_id', '==', from.id)
          .get();
        if (!dup.empty) {
          skipped++;
          continue;
        }
      }

      // 写入订单
      await db.collection('triggered_comments').add({
        selling_id,
        product_name: product.product_name,
        user_id: from.id,
        user_name: from.name || '',
        comment_id,
        post_id,
        created_at: new Date().toISOString(),
        payment_url: '',
        replied: false
      });
      success++;
    }

    return res.status(200).json({ message: '订单写入完成', success, skipped });
  } catch (err) {
    console.error('执行失败：', err);
    return res.status(500).json({ error: '执行失败', message: err.message });
  }
}
