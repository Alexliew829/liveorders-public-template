// pages/api/scanAllComments.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

function normalizeSellingId(raw) {
  const match = raw.match(/[a-zA-Z]\s*[-_~.\uFF5E]*\s*0*(\d{1,3})/);
  if (!match) return raw.trim().toUpperCase();
  const letter = raw.match(/[a-zA-Z]/)[0].toUpperCase();
  const num = match[1].padStart(3, '0');
  return `${letter}${num}`;
}

function extractQuantity(message) {
  let qty = 1;
  const matches = message.match(/(?:[+xX*\u00D7\uFF0D\-\u2013])\s*(\d{1,3})/gi);
  if (matches && matches.length > 0) {
    const nums = matches.map(m => parseInt(m.replace(/[^\d]/g, ''))).filter(n => !isNaN(n));
    if (nums.length > 0) qty = Math.max(...nums);
  }
  return qty;
}

async function fetchAllComments(postId) {
  const allComments = [];
  let next = `https://graph.facebook.com/${postId}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`;

  while (next) {
    const res = await fetch(next);
    const json = await res.json();
    if (!json?.data?.length) break;
    allComments.push(...json.data);
    next = json.paging?.next || null;
  }

  return allComments;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '只允许 POST 请求' });

  try {
    const configSnap = await db.collection('config').doc('last_post_id').get();
    if (!configSnap.exists) return res.status(400).json({ error: '未设定直播贴文 ID' });

    const post_id = configSnap.data().post_id;
    const comments = await fetchAllComments(post_id);

    let added = 0, skipped = 0, ignored = 0;

    for (const comment of comments) {
      const { id: comment_id, message, from } = comment;
      if (!message || !from || from.id === PAGE_ID) { ignored++; continue; }

      const match = message.match(/[aAbB][\s\-_.～]*0{0,2}(\d{1,3})/);
      if (!match) { skipped++; continue; }

      const selling_id = normalizeSellingId(match[0]);
      const prefix = selling_id[0];
      const quantity = extractQuantity(message);
      const user_id = from.id;
      const user_name = from.name || `访客_${comment_id.slice(-4)}`;

      const productRef = db.collection('live_products').doc(selling_id);
      const productSnap = await productRef.get();
      if (!productSnap.exists) { skipped++; continue; }
      const product = productSnap.data();

      const cleanPrice = typeof product.price === 'string'
        ? parseFloat(product.price.replace(/,/g, ''))
        : product.price || 0;

      const payload = {
        post_id,
        comment_id,
        message,
        user_id,
        user_name,
        created_at: Date.now(),
        replied: false,
        selling_id,
        product_name: product.product_name || '',
        price: cleanPrice
      };

      if (prefix === 'B') {
        const docRef = db.collection('triggered_comments').doc(selling_id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          await docRef.set({ ...payload, quantity: 1 });
          added++;
        } else {
          skipped++;
        }
      } else {
        const docId = `${selling_id}_${comment_id}`;

        const stock = product.stock || 0;
        let stockLimited = false;

        if (stock > 0) {
          const querySnap = await db.collection('triggered_comments')
            .where('selling_id', '==', selling_id)
            .get();

          let totalOrdered = 0;
          querySnap.forEach(doc => {
            const data = doc.data();
            totalOrdered += parseInt(data.quantity) || 0;
          });

          if (totalOrdered >= stock) { skipped++; continue; }
          else if (totalOrdered + quantity > stock) {
            payload.quantity = stock - totalOrdered;
          } else {
            payload.quantity = quantity;
          }
          stockLimited = true;
        } else {
          payload.quantity = quantity;
        }

        payload.stock_limited = stockLimited;

        // ✅ 关键改动：强制写入，不判断是否存在
        await db.collection('triggered_comments').doc(docId).set(payload);
        added++;
      }
    }

    return res.status(200).json({
      message: `✅ 补扫完成，共新增 ${added} 条订单`,
      added,
      skipped,
      ignored,
      total: comments.length
    });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', details: err.message });
  }
}
