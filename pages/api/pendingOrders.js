import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

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

      const rawPrice =
        typeof product.price === 'string'
          ? product.price.replace(/,/g, '')
          : product.price;
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

    // ✅ 格式化显示内容（纯文本）
    const textBlocks = [];
    let grandTotal = 0;

    for (const user of result) {
      textBlocks.push(`🧾 ${user.user_name}`);

      for (const item of user.items) {
        const line = `▪️ ${item.selling_id} ${item.product_name} ${item.price.toFixed(2)} x ${item.quantity} = RM${item.subtotal.toFixed(2)}`;
        textBlocks.push(line);
      }

      textBlocks.push(`总金额：RM${user.total.toFixed(2)}\n`);
      grandTotal += user.total;
    }

    if (textBlocks.length > 0) {
      textBlocks.push(`🔸 总销售额：RM${grandTotal.toFixed(2)}`);
    }

    res.setHeader('Content-Type', 'text/plain'); // ✅ 返回纯文本，避免 JSON 错误
    res.status(200).send(textBlocks.join('\n\n'));
  } catch (err) {
    res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
