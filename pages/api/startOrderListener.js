import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

function normalizeId(id) {
  const match = id.match(/[ABab]\s*-*_*\s*(\d{1,3})/);
  if (!match) return null;
  return (id[0].toUpperCase() === 'A' ? 'A' : 'B') + match[1].padStart(3, '0');
}

function extractProductInfo(message) {
  const match = message.match(/([ABab]\s*-*_*\s*\d{1,3})[\s\-～_]*([\u4e00-\u9fa5\w\s]*)[\s\-～_]*RM\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const originalId = match[1].replace(/\s|\-|_/g, '').toUpperCase();
  const name = match[2].trim();
  const rawPrice = parseFloat(match[3].replace(/,/g, ''));
  const formattedPrice = rawPrice.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    selling_id: normalizeId(originalId),
    original_id: originalId,
    product_name: `${originalId} ${name} RM${formattedPrice}`,
    price_raw: rawPrice,
    price: formattedPrice
  };
}

export default async function handler(req, res) {
  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) return res.status(500).json({ error: '无法获取贴文 ID' });

    // 获取留言
    const commentsRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentsData = await commentsRes.json();
    const comments = commentsData?.data || [];

    const batch = db.batch();
    const now = new Date();
    const productsRef = db.collection('live_products');

    // 先清空 live_products
    const oldDocs = await productsRef.listDocuments();
    oldDocs.forEach(doc => batch.delete(doc));

    let count = 0;
    for (const comment of comments) {
      if (comment.from?.id === PAGE_ID) {
        const info = extractProductInfo(comment.message);
        if (info) {
          batch.set(productsRef.doc(info.original_id), {
            ...info,
            category: info.selling_id.startsWith('A') ? 'A' : 'B',
            created_at: now,
            post_id
          });
          count++;
        }
      }
    }

    await batch.commit();
    res.status(200).json({ message: `成功写入 ${count} 个商品资料` });
  } catch (err) {
    res.status(500).json({ error: '发生错误', details: err.message });
  }
}
