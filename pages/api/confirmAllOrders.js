import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // 获取贴文留言
    const commentsRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=200&fields=from,message,created_time`);
    const commentsData = await commentsRes.json();
    const comments = commentsData?.data || [];

    // 读取旧订单（相同直播）避免重复写入
    const existingSnap = await db.collection('triggered_comments').where('post_id', '==', post_id).get();
    const existing = existingSnap.docs.map(doc => doc.data());

    // 提取所有商品编号（已写入的）
    const liveProductsSnap = await db.collection('live_products').where('post_id', '==', post_id).get();
    const products = liveProductsSnap.docs.map(doc => doc.data());

    let success = 0;
    let skipped = 0;

    for (const c of comments) {
      const fromId = c.from?.id;
      const fromName = c.from?.name;
      const msg = c.message?.toUpperCase() || '';

      if (!fromId || !msg) continue;
      if (fromId === PAGE_ID) continue; // 跳过管理员留言

      // 匹配格式：前后各可加两个字母干扰，如“我要B01”、“B01咯”
      const match = msg.match(/.{0,2}(B\s*-*0*\d{1,3}).{0,2}/i);
      if (!match) continue;

      const selling_id = match[1].replace(/\s|-/g, '').toUpperCase();
      const product = products.find(p => p.selling_id === selling_id);
      if (!product) continue;

      const exists = existing.find(e => e.selling_id === selling_id && e.user_id === fromId);
      if (product.type === 'B') {
        const bExists = existing.find(e => e.selling_id === selling_id);
        if (bExists) {
          skipped++;
          continue;
        }
      } else {
        if (exists) {
          skipped++;
          continue;
        }
      }

      await db.collection('triggered_comments').add({
        post_id,
        selling_id,
        user_id: fromId,
        user_name: fromName,
        message: c.message,
        comment_id: c.id,
        created_time: c.created_time,
        replied: false
      });
      success++;
    }

    return res.status(200).json({ message: '订单写入完成', success, skipped });

  } catch (err) {
    console.error('写入失败:', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
