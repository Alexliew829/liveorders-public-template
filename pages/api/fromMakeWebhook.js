import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;

// ✅ 更安全的编号标准化
function normalizeSellingId(raw) {
  const match = raw.match(/([aAbB])[\s\-_.=~～]*0*(\d{1,3})/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const num = match[2].padStart(3, '0');
  return `${letter}${num}`;
}

// ✅ 提取留言中的数量，支持 +10 / x2 / *3 等格式
function extractQuantity(message) {
  let qty = 1;
  const matches = message.match(/(?:[+xX*×－\-\u2013])\s*(\d{1,3})/gi);
  if (matches && matches.length > 0) {
    const nums = matches.map(m => parseInt(m.replace(/[^\d]/g, ''))).filter(n => !isNaN(n));
    if (nums.length > 0) {
      const maxQty = Math.max(...nums);
      if (maxQty > 0) qty = maxQty;
    }
  }
  return qty;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const { post_id, comment_id, message, user_id, user_name, force } = req.body;
    const isForce = force === true || force === 'true';

    if (!post_id || !comment_id || !message) {
      console.warn('⛔ 缺少字段', { post_id, comment_id, message });
      return res.status(400).json({ error: '缺少必要字段：post_id / comment_id / message' });
    }

    if (!user_id) {
      console.warn('⚠️ 未提供 user_id，可能为陌生访客', { comment_id, message });
    }

    if (user_id === PAGE_ID) {
      return res.status(200).json({ message: '已忽略主页留言' });
    }

    const match = message.match(/([aAbB])[\s\-_.=~～]*0*(\d{1,3})/);
    if (!match) {
      return res.status(200).json({ message: '无有效商品编号，跳过处理' });
    }

    const selling_id = normalizeSellingId(`${match[1]}${match[2]}`);
    if (!selling_id) {
      return res.status(200).json({ message: '无法标准化编号，跳过处理' });
    }

    const prefix = selling_id[0];
    let quantity = extractQuantity(message);

    const productRef = db.collection('live_products').doc(selling_id);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      return res.status(200).json({ message: `编号 ${selling_id} 不存在于商品列表中，跳过处理` });
    }

    const product = productSnap.data();
    const cleanPrice = typeof product.price === 'string'
      ? parseFloat(product.price.replace(/,/g, ''))
      : product.price || 0;

    const payloadBase = {
      post_id,
      comment_id,
      message,
      user_id: user_id || '',
      user_name: user_name || `访客_${comment_id.slice(-4)}`,
      created_at: Date.now(),
      replied: false,
      selling_id,
      product_name: product.product_name || '',
      price: cleanPrice,
    };

    if (prefix === 'B') {
      const docRef = db.collection('triggered_comments').doc(selling_id);
      if (!isForce) {
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          return res.status(200).json({ message: `编号 ${selling_id} 已被抢购（B 类限一人）` });
        }
      }
      await docRef.set({ ...payloadBase, quantity: 1 });
      return res.status(200).json({ message: '✅ B 类下单成功', doc_id: selling_id });
    } else {
      const docId = `${selling_id}_${comment_id}`;
      if (!isForce) {
        const existing = await db.collection('triggered_comments').doc(docId).get();
        if (existing.exists) {
          return res.status(200).json({ message: 'A 类订单已存在，跳过' });
        }
      }

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

        if (totalOrdered >= stock) {
          return res.status(200).json({
            message: `❌ 已售罄，库存为 ${stock}，当前已下单 ${totalOrdered}`
          });
        } else if (totalOrdered + quantity > stock) {
          quantity = stock - totalOrdered;
        }

        stockLimited = true;
      }

      await db.collection('triggered_comments').doc(docId).set({
        ...payloadBase,
        quantity,
        stock_limited: stockLimited
      });

      return res.status(200).json({
        message: quantity < extractQuantity(message)
          ? `⚠️ 部分下单成功，仅写入剩余 ${quantity}`
          : '✅ A 类下单成功',
        doc_id: docId
      });
    }
  } catch (err) {
    return res.status(500).json({ error: '❌ 系统错误，写入失败', details: err.message?.toString() || '' });
  }
}
