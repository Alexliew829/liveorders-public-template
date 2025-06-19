import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    // 清空旧资料
    const oldProducts = await db.collection('live_products').listDocuments();
    for (const doc of oldProducts) {
      await doc.delete();
    }
    const oldOrders = await db.collection('orders').listDocuments();
    for (const doc of oldOrders) {
      await doc.delete();
    }

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    const productList = [];

    for (const comment of comments) {
      const { message = '', from = {}, id: comment_id } = comment;
      if (from.id !== PAGE_ID && /^(A|B)\d{1,3}/i.test(message)) {
        const [selling_id] = message.match(/(A|B)\s*\d{1,3}/i) || [];
        const category = selling_id?.trim().toUpperCase().startsWith('A') ? 'A' : 'B';
        const price_match = message.match(/RM\s*(\d+[,.]?\d*)/i);
        const price_raw = Number(price_match?.[1]?.replace(/,/g, '') || 0);
        const price_fmt = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

        productList.push({
          comment_id,
          post_id,
          selling_id: selling_id?.replace(/\s+/g, '').toUpperCase(),
          product_name: message.replace(/(A|B)\s*\d{1,3}/i, '').replace(/RM.*/i, '').trim(),
          category,
          price: price_raw,
          price_fmt,
          created_at: new Date().toISOString()
        });
      }
    }

    const batch = db.batch();
    for (const product of productList) {
      const docId = `${post_id}_${product.selling_id}`;
      const ref = db.collection('live_products').doc(docId);
      batch.set(ref, product);
    }
    await batch.commit();

    return res.status(200).json({ success: true, count: productList.length });
  } catch (err) {
    console.error('记录商品失败:', err);
    return res.status(500).json({ error: '记录商品失败', detail: err.message });
  }
}
