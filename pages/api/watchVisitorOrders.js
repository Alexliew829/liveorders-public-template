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
    // 获取最新贴文 ID
    const postRes = await fetch(
      `https://graph.facebook.com/${PAGE_ID}/posts?access_token=${process.env.FB_ACCESS_TOKEN}&limit=1`
    );
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    // 删除旧订单资料
    const prevOrdersSnap = await db.collection('triggered_comments').where('post_id', '==', post_id).get();
    const batch = db.batch();
    prevOrdersSnap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    // 获取所有留言
    const allComments = [];
    let nextPage = `https://graph.facebook.com/${post_id}/comments?access_token=${process.env.FB_ACCESS_TOKEN}&fields=id,message,from,created_time&limit=100`;
    while (nextPage) {
      const res = await fetch(nextPage);
      const data = await res.json();
      allComments.push(...(data.data || []));
      nextPage = data.paging?.next || null;
    }

    const productsRef = db.collection('live_products');
    const productSnapshot = await productsRef.where('post_id', '==', post_id).get();
    const productList = [];
    productSnapshot.forEach((doc) => {
      const item = doc.data();
      const id = item.selling_id?.toLowerCase().replace(/\s+/g, '').replace(/^0+/, '');
      if (id) {
        productList.push({ ...item, id });
      }
    });

    let success = 0,
      skipped = 0,
      failed = 0;

    const existingB = new Set();

    for (const comment of allComments) {
      const { message, from, id: comment_id, created_time } = comment;
      if (!message || !from || from.id === PAGE_ID) {
        skipped++;
        continue;
      }

      const messageText = message.toLowerCase().replace(/\s+/g, '').replace(/^0+/, '');
      const matched = productList.find((p) => messageText.includes(p.id));
      if (!matched) {
        skipped++;
        continue;
      }

      try {
        const isB = matched.category?.toUpperCase() === 'B';
        const isA = matched.category?.toUpperCase() === 'A';

        if (isB) {
          if (existingB.has(matched.selling_id)) {
            skipped++;
            continue;
          } else {
            existingB.add(matched.selling_id);
          }
        }

        const price_raw = Number(matched.price || 0);
        const price_fmt = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

        await db.collection('triggered_comments').add({
          comment_id,
          post_id,
          user_id: from.id,
          user_name: from.name || '',
          selling_id: matched.selling_id,
          product_name: matched.product_name || '',
          category: matched.category || '',
          price: price_raw,
          price_fmt,
          created_time,
          replied: false,
        });

        success++;
      } catch (err) {
        console.error('写入失败:', err);
        failed++;
      }
    }

    return res.status(200).json({
      message: '识别完成 ✅',
      post_id,
      success,
      skipped,
      failed,
      total: allComments.length,
    });
  } catch (err) {
    console.error('系统异常:', err);
    return res.status(500).json({ error: '系统异常', detail: err.message });
  }
}
