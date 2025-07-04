import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// ✅ 标准化编号，例如 a-032、A 32 → A032
function normalizeSellingId(id = '') {
  const match = id.toUpperCase().match(/[A]\s*[-_~.～]*\s*0*(\d{1,3})/);
  return match ? `A${match[1].padStart(3, '0')}` : id.toUpperCase();
}

export default async function handler(req, res) {
  try {
    const snapshot = await db
      .collection('triggered_comments')
      .orderBy('created_at', 'asc')
      .get();

    const grouped = new Map();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const user_id = data.user_id || 'anonymous';
      const user_name = data.user_name || '匿名顾客';

      const normalizedId = normalizeSellingId(data.selling_id);
      if (!normalizedId.startsWith('A')) continue; // 只处理 A 类

      const productDoc = await db.collection('live_products').doc(normalizedId).get();
      if (!productDoc.exists) continue;

      const product = productDoc.data();
      if (product.type !== 'A') continue;

      const rawPrice = typeof product.price === 'string'
        ? product.price.replace(/,/g, '')
        : product.price;
      const unitPrice = parseFloat(rawPrice) || 0;
      const quantity = parseInt(data.quantity) || 1;
      const subtotal = +(unitPrice * quantity).toFixed(2);

      const item = {
        selling_id: normalizedId,
        product_name: product.product_name,
        quantity,
        price: unitPrice,
        subtotal
      };

      const key = normalizedId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ ...item, user_name });
    }

    const result = [];
    for (const [selling_id, orders] of grouped.entries()) {
      result.push({
        selling_id,
        product_name: orders[0].product_name,
        orders: orders.map(o => `${selling_id} ${o.product_name} ${o.quantity} ${o.user_name}`)
      });
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: '读取失败', detail: err.message });
  }
}
