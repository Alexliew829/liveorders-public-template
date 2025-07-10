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
  const { post_id, comment_id, force = 'no' } =
    req.method === 'POST' ? req.body : req.query;

  if (!comment_id || !post_id) {
    return res.status(400).json({ error: '缺少 post_id 或 comment_id 参数' });
  }

  try {
    // ✅ 查找该顾客的留言记录
    const querySnap = await db
      .collection('triggered_comments')
      .where('comment_id', '==', comment_id)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return res.status(404).json({ error: '找不到该留言记录' });
    }

    const commentSnap = querySnap.docs[0];
    const commentData = commentSnap.data();

    if (commentData.replied_public && force !== 'yes') {
      return res.status(200).json({
        success: false,
        message: '该顾客已发送过付款连接，若要重复发送请加上 &force=yes'
      });
    }

    const { user_id, user_name } = commentData;

    // ✅ 查找该顾客的所有订单
    const orderSnap = await db
      .collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    for (const doc of orderSnap.docs) {
      const { selling_id, quantity } = doc.data();
      const sid = (selling_id || '').toUpperCase();
      const productDoc = await db.collection('live_products').doc(sid).get();
      const productData = productDoc.exists ? productDoc.data() : null;
      if (!productData) continue;

      const rawPrice = typeof productData.price === 'string'
        ? productData.price.replace(/,/g, '')
        : productData.price;
      const price = parseFloat(rawPrice || 0);
      const qty = parseInt(quantity) || 1;
      const subtotal = +(price * qty).toFixed(2);
      total = +(total + subtotal).toFixed(2);
    }

    // ✅ 构建留言内容（在顾客原留言下方留言）
    const suffix = `#${Date.now().toString().slice(-5)}`;
   const tagged = user_id ? `@[${user_id}]` : user_name || '顾客';
    const message = `感谢支持 ${tagged} 🙏\n我们已通过 Messenger 发出付款详情，请点击查看：\nhttps://m.me/lover.legend.gardening ${suffix}`;
    // ✅ 改为在 comment_id 下留言，确保顾客可见
    const replyRes = await fetch(`https://graph.facebook.com/${comment_id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        message,
        access_token: PAGE_TOKEN
      })
    });

    const fbRes = await replyRes.json();
    console.log('Facebook 留言回传结果：', JSON.stringify(fbRes, null, 2));

    if (!replyRes.ok || fbRes.error) {
      return res.status(500).json({ error: '发送失败：无法回复该留言', fbRes });
    }

    // ✅ 更新数据库状态为已公开留言
    const batch = db.batch();
    orderSnap.docs.forEach(doc => {
      batch.update(doc.ref, { replied_public: true });
    });
    await batch.commit();

    return res.status(200).json({
      success: true,
      message: `已回复留言成功通知 ${user_name || '顾客'}`,
      total: total.toFixed(2),
      fbRes
    });

  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
