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
  const { comment_id, channel = 'comment' } =
    req.method === 'POST' ? req.body : req.query;

  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
    // 查找该顾客的订单留言
    const querySnap = await db
      .collection('triggered_comments')
      .where('comment_id', '==', comment_id)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return res.status(404).json({ error: '找不到该留言记录' });
    }

    const commentSnap = querySnap.docs[0];
    const { user_id } = commentSnap.data();

    // 查找此顾客的所有订单
    const orderSnap = await db
      .collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    let productLines = [];

    for (const doc of orderSnap.docs) {
      const { selling_id, product_name, quantity } = doc.data();

      const productDoc = await db.collection('live_products').doc(selling_id).get();
      const productData = productDoc.exists ? productDoc.data() : null;
      if (!productData) continue;

      const rawPrice = typeof productData.price === 'string'
        ? productData.price.replace(/,/g, '')
        : productData.price;
      const price = parseFloat(rawPrice || 0);

      const qty = parseInt(quantity) || 1;
      const subtotal = +(price * qty).toFixed(2);
      total = +(total + subtotal).toFixed(2);

      // ✅ 明确列出：品名 + 单价 x 数量 = 小计
      productLines.push({
        selling_id,
        line: `▪️ ${selling_id} ${product_name} ${price.toFixed(2)} x ${qty} = RM${subtotal.toFixed(2)}`
      });
    }

    // ✅ 商品排序（按 A/B + 编号排序）
    productLines.sort((a, b) => {
      const parseKey = (id) => {
        const match = id.match(/^([A-Za-z]+)\s*0*(\d+)/);
        return match ? [match[1].toUpperCase(), parseInt(match[2])] : [id, 0];
      };
      const [typeA, numA] = parseKey(a.selling_id);
      const [typeB, numB] = parseKey(b.selling_id);
      return typeA === typeB ? numA - numB : typeA.localeCompare(typeB);
    });

    const totalStr = `总金额：RM${total.toFixed(2)}`;
    const sgd = (total / 3.25).toFixed(2);
    const sgdStr = `SGD${sgd} PayLah! / PayNow me @87158951 (Siang)`;

    const paymentMessage = [
      `感谢你的支持 🙏，订单详情`,
      ...productLines.map(p => p.line),
      '',
      totalStr,
      sgdStr,
      '',
      '付款方式：',
      'Lover Legend Adenium',
      'Maybank：512389673060',
      'Public Bank：3214928526',
      '',
      'TNG 付款连接：',
      'https://liveorders-public-template.vercel.app/TNG.jpg',
      '📸 付款后请截图发到后台：https://m.me/lover.legend.gardening'
    ].join('\n');

    // ✅ 公开回复留言
    const replyRes = await fetch(`https://graph.facebook.com/${comment_id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: paymentMessage,
        access_token: PAGE_TOKEN
      })
    });

    const fbRes = await replyRes.json();
    if (!replyRes.ok) {
      return res.status(500).json({ error: '发送失败：无法公开回复订单详情', fbRes });
    }

    // ✅ 标记为已公开回复
    await commentSnap.ref.update({ replied_public: true });

    return res.status(200).json({ success: true, total: total.toFixed(2), fbRes });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
