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
    // 1. 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    // 2. 获取已存在的商品（取第一个）
    const existingSnap = await db.collection('live_products').limit(1).get();
    let existingPostId = null;
    if (!existingSnap.empty) {
      existingPostId = existingSnap.docs[0].data()?.post_id;
    }

    // 3. 如果是不同场直播，则删除旧的商品与订单
    if (existingPostId && existingPostId !== post_id) {
      const oldProducts = await db.collection('live_products').get();
      const oldOrders = await db.collection('orders').get();

      await Promise.all([
        ...oldProducts.docs.map(doc => doc.ref.delete()),
        ...oldOrders.docs.map(doc => doc.ref.delete())
      ]);
    }

    // 4. 获取最新留言（写入商品）
    const allComments = [];
    let nextPage = `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id&limit=100`;

    while (nextPage) {
      const res = await fetch(nextPage);
      const data = await res.json();
      allComments.push(...(data.data || []));
      nextPage = data.paging?.next || null;
    }

    let success = 0;
    const productRegex = /(A|B)\s*0*(\d{1,3})[\s\-_/～～~]*([\u4e00-\u9fa5A-Za-z0-9\s]{1,30})[\s\-_/～～~]*RM\s*(\d+[,.]?\d*)/i;

    for (const c of allComments) {
      if (!c.message || !c.from || c.from.id !== PAGE_ID) continue;
      const match = c.message.match(productRegex);
      if (!match) continue;

      const selling_id = `${match[1].toUpperCase()}${match[2].padStart(3, '0')}`;
      const product_name = match[3].trim();
      const price = parseFloat(match[4].replace(',', ''));
      const price_fmt = price.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      await db.collection('live_products').doc(`${post_id}_${selling_id}`).set({
        post_id,
        selling_id,
        product_name,
        price,
        price_fmt,
        created_at: new Date().toISOString()
      });
      success++;
    }

    return res.status(200).json({ message: '商品识别完成', success, total: allComments.length, post_id });
  } catch (err) {
    console.error('[记录商品失败]', err);
    return res.status(500).json({ error: '识别失败', detail: err.message });
  }
}
