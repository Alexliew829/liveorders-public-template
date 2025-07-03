import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

function formatMoney(n) {
  return n.toLocaleString('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace('MYR', 'RM').replace(/\u00A0/g, '');
}

export default async function handler(req, res) {
  try {
    const snapshot = await db
      .collection('triggered_comments')
      .orderBy('created_at', 'asc')
      .get();

    const map = new Map();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.replied === true) continue;

      const user_id = data.user_id || 'anonymous';
      const user_name = data.user_name || '匿名顾客';
      const key = user_id;

      const productDoc = await db.collection('live_products').doc(data.selling_id).get();
      if (!productDoc.exists) continue;
      const product = productDoc.data();

      const rawPrice = typeof product.price === 'string' ? product.price.replace(/,/g, '') : product.price;
      const unitPrice = parseFloat(rawPrice) || 0;
      const quantity = parseInt(data.quantity) || 1;
      const subtotal = unitPrice * quantity;

      const item = {
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity,
        price: unitPrice,
        subtotal,
      };

      if (!map.has(key)) {
        map.set(key, {
          user_id,
          user_name,
          comment_id: data.comment_id || '',
          items: [item],
          total: subtotal,
        });
      } else {
        const existing = map.get(key);
        existing.items.push(item);
        existing.total += subtotal;
      }
    }

    const result = Array.from(map.values());

    // ✅ 拼接文字格式（新版格式）
    const textBlocks = [];
    let grandTotal = 0;

    for (const order of result) {
      const lines = [];
      lines.push(`🧾 ${order.user_name}`);

      for (const item of order.items) {
        const id = item.selling_id;
        const name = item.product_name;
        const qty = item.quantity;
        const unit = item.price.toFixed(2);
        const total = formatMoney(item.subtotal);
        lines.push(`▪️ ${id} ${name} ${unit} x ${qty} = ${total}`);
      }

      lines.push(`💰 小计：${formatMoney(order.total)}`);
      textBlocks.push(lines.join('\n'));

      grandTotal += order.total;
    }

    if (textBlocks.length > 0) {
      textBlocks.push(`\n🔸 总销售额：${formatMoney(grandTotal)}`);
    }

    res.status(200).send(textBlocks.join('\n\n'));
  } catch (err) {
    res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
