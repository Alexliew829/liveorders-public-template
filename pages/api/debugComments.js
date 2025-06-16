// pages/api/debugComments.js
export default async function handler(req, res) {
  const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;
  const POST_ID = req.query.post_id;

  if (!POST_ID) {
    return res.status(400).json({ error: '请提供 post_id' });
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${POST_ID}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from&limit=100`
    );
    const data = await response.json();

    if (!data?.data?.length) {
      return res.status(404).json({ error: '无留言或抓取失败', raw: data });
    }

    // 精简输出留言内容与留言者
    const result = data.data.map((cmt) => ({
      id: cmt.id,
      message: cmt.message,
      from: cmt.from ? { id: cmt.from.id, name: cmt.from.name } : '匿名用户',
    }));

    return res.status(200).json({ total: result.length, comments: result });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
