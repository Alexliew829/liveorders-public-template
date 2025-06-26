import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

function extractProductInfo(message) {
  const pattern = /([ABab][\s-]*0*\d{1,3})[\s\-～_:：]?(.*?)[\s\-～_:：]?[Rr][Mm]?[ \t]*([\d,.]+)/;
  const match = message.match(pattern);
  if (!match) return null;

  const selling_id_raw = match[1].replace(/\s|-/g, '').toUpperCase(); // A032 → A032
  const category = selling_id_raw.startsWith('A') ? 'A' : 'B';
  const product_name = match[2].trim();
  const price_raw = parseFloat(match[3].replace(/,/g, ''));
  const price_fmt = price_raw.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return {
    selling_id: selling_id_raw,
    category,
    product_name: `${selling_id_raw} ${product_name}`,
    price_raw,
    price: price_fmt,
  };
}

export default async function handler(req, res) {
  try {
    // Step 1：取得最新贴文
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });

    // Step 2：取得留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=200`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    // Step 3：清除旧的商品资料
    const oldSnapshot = await db.collection('live_products').get();
    const batchDelete = db.batch();
    oldSnapshot.forEach(doc => batchDelete.delete(doc.ref));
    await batchDelete.commit();

    // Step 4：写入新的商品资料（仅主页留言）
    const filtered = comments.filter(c => c.from?.id === PAGE_ID);
    let count = 0;

    for (const comment of filtered) {
      const parsed = extractProductInfo(comment.message);
      if (parsed) {
        await db.collection('live_products').doc(parsed.selling_id).set({
          ...parsed,
          post_id,
          created_at: Timestamp.now(),
        });
        count++;
      }
    }

    res.status(200).json({
      success: true,
      message: `已清空旧留言并记录 ${count} 项商品`,
      post_id,
    });
  } catch (err) {
    console.error('[startOrderListener 错误]', err);
    res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
