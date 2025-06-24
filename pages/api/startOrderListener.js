export default async function handler(req, res) {
  const isDebug = req.query.debug !== undefined;

  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;

    for (const comment of comments) {
      const { message, id: comment_id, from } = comment;
      if (!message || typeof message !== 'string') continue;
      if (!from || from.id !== PAGE_ID) continue;

      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      const priceMatch = message.match(/(?:RM|rm)?[^\d]*([\d,]+\.\d{2})\s*$/i);
      if (!priceMatch) continue;

      const price_raw = priceMatch[1].replace(/,/g, '');
      const price = parseFloat(price_raw);
      const price_fmt = price.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      const product_name = message.replace(/\s*RM[\d,]+\.\d{2}$/i, '').trim();

      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        type,
        number,
        price,
        price_raw,
        price_fmt,
        raw_message: message,
        product_name,
        created_at: new Date().toISOString(),
        post_id,
      });

      count++;
    }

    return res.status(200).json({ message: '商品写入完成', success: count });

  } catch (err) {
    console.error('执行错误', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
