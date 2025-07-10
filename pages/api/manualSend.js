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
  const { comment_id, force = 'no' } =
    req.method === 'POST' ? req.body : req.query;

  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
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

    const orderSnap = await db
      .collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    let productLines = [];

    for (const doc of orderSnap.docs) {
      const { selling_id, product_name, quantity } = doc.data();
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

      productLines.push({
        sid,
        name: product_name,
        qty,
        price,
        subtotal
      });
    }

    productLines.sort((a, b) => {
      const typeA = /^[Aa]/.test(a.sid) ? 'A' : 'B';
      const typeB = /^[Aa]/.test(b.sid) ? 'A' : 'B';
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      const numA = parseInt(a.sid.replace(/[^\d]/g, '') || '0');
      const numB = parseInt(b.sid.replace(/[^\d]/g, '') || '0');
      return numA - numB;
    });

    // ✅ 留言内容：不含链接 + 不以 emoji 开头 + 中英并列
    const suffix = `#${Date.now().toString().slice(-5)}`; // 可保留用于防重复
    const paymentMessage = `感谢你的支持，我们已通过 Messenger 发出付款详情，请查阅收件箱。\nThank you for your support! Payment info has been sent via Messenger inbox. ${suffix}`;

    const replyRes = await fetch(`https://graph.facebook.com/${comment_id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        message: paymentMessage,
        access_token: PAGE_TOKEN
      })
    });

    const fbRes = await replyRes.json();
    console.log('Facebook 留言回传结果：', JSON.stringify(fbRes, null, 2));

    if (!replyRes.ok || fbRes.error) {
      return res.status(500).json({ error: '发送失败：无法公开回复订单详情', fbRes });
    }

    const batch = db.batch();
    orderSnap.docs.forEach(doc => {
      batch.update(doc.ref, { replied_public: true });
    });
    await batch.commit();

    return res.status(200).json({
      success: true,
      message: `成功发送订单详情给 ${user_name || '顾客'}`,
      total: total.toFixed(2),
      fbRes
    });

  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
