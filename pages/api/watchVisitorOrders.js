import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env['firebase-admin-key.json']);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只接受 POST 请求' });
  }

  const { post_id } = req.body;

  if (!post_id) {
    return res.status(400).json({ error: '缺少 post_id 参数' });
  }

  try {
    // Step 1: 读取 Firebase 中所有商品
    const snapshot = await db.collection('live_products').where('post_id', '==', post_id).get();
    const products = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      products[data.selling_id.toUpperCase()] = data;
    });

    if (Object.keys(products).length === 0) {
      return res.status(200).json({ message: '没有任何商品可监听' });
    }

    // Step 2: 抓取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id&limit=100`);
    const commentData = await commentRes.json();

    const matched = [];

    for (const comment of commentData.data || []) {
      const msg = comment.message?.toUpperCase().replace(/\s+/g, '');
      const user = comment.from;
      const comment_id = comment.id;

      if (!msg || !user?.id) continue;

      // 🧪 暂时允许管理员留言测试，正式上线时可加判断跳过 PAGE_ID
      // if (user.id === PAGE_ID) continue;

      for (const id in products) {
        if (msg.includes(id)) {
          // 检查是否已有该商品订单
          const orders = await db.collection('triggered_comments')
            .where('selling_id', '==', id)
            .get();

          const already = orders.docs.some(doc => doc.data().from_id === user.id);
          if (already) continue;

          // Step 3: 写入订单记录
          await db.collection('triggered_comments').add({
            comment_id,
            post_id,
            selling_id: id,
            from_id: user.id,
            from_name: user.name || '匿名用户',
            created_at: new Date()
          });

          // Step 4: 自动留言回复付款连接
          const product = products[id];
          const message = `🎉 感谢下单 ${id} ${product.product_name}，价格 RM${product.price_raw}\n请点击以下付款连接完成订单（限时 60 分钟）：\nhttps://your-payment-link.com?id=${comment_id}`;

          await fetch(`https://graph.facebook.com/${comment_id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message,
              access_token: PAGE_TOKEN
            })
          });

          matched.push({ user: user.name, selling_id: id });
          break;
        }
      }
    }

    return res.status(200).json({
      success: true,
      matched,
    });

  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
