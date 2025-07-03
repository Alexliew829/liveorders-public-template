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
      const user_id = data.user_id || 'anonymous';
      const user_name = data.user_name || '匿名顾客';
      const key = user_id;

      const productDoc = await db.collection('live_products').doc(data.selling_id).get();
      if (!productDoc.exists) continue;
      const product = productDoc.data();

      const rawPrice = typeof product.price === 'string'
        ? product.price.replace(/,/g, '')
        : product.price;
      const unitPrice = parseFloat(rawPrice) || 0;
      const quantity = parseInt(data.quantity) || 1;
      const subtotal = +(unitPrice * quantity).toFixed(2);

      const item = {
        selling_id: data.selling_id,
        product_name: data.product_name,
        quantity,
        price: unitPrice,
        subtotal
      };

      if (!map.has(key)) {
        map.set(key, {
          user_id,
          user_name,
          comment_id: data.comment_id || '',
          replied: data.replied || false,
          items: [item],
          total: subtotal
        });
      } else {
        const existing = map.get(key);
        existing.items.push(item);
        existing.total = +(existing.total + subtotal).toFixed(2);
      }
    }

    const result = Array.from(map.values()).map(order => {
      const itemLines = order.items.map(
        item => `▪️ ${item.selling_id} ${item.product_name} x${item.quantity} = RM${item.subtotal.toFixed(2)}`
      );

      const sgd = (order.total / 3.25).toFixed(2);
      const message = [
        `感谢你的支持 🙏`,
        ...itemLines,
        '',
        `总金额：RM${order.total.toFixed(2)}`,
        `SGD${sgd} PayLah! / PayNow me @87158951 (Siang)`,
        '',
        `付款方式：`,
        `Lover Legend Adenium`,
        `Maybank：512389673060`,
        `Public Bank：3214928526`,
        '',
        `TNG 付款连接：`,
        `https://liveorders-public-template.vercel.app/TNG.jpg`
      ].join('\n');

      return {
        ...order,
        message
      };
    }).sort((a, b) => a.user_name.localeCompare(b.user_name));

    res.status(200).json(result.slice(0, 100));
  } catch (err) {
    res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
